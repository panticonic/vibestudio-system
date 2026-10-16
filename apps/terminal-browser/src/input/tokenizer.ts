/**
 * Splits raw terminal input into events: keys (with their exact bytes, so
 * session input passes through unchanged), bracketed pastes and SGR mouse
 * reports. Stateful across chunks: a paste or an escape sequence may arrive
 * split over several reads. A terminal writes each key's bytes at once, so
 * a lone ESC that ends a read is the Escape key, not the start of a sequence
 * still on its way; CSI-u terminals disambiguate it outright.
 */

export interface KeyEvent {
  kind: "key";
  /** Normalized name: "a", "A", "?", "enter", "up", "C-a", "C-space", "M-x", "C-up", "f1", ... */
  name: string;
  /** The exact bytes the terminal sent, as a string. */
  seq: string;
  /** Enhanced keyboard events are encoded for the hosted program's own mode. */
  protocol?: "csi-u";
  codepoint?: number;
  modifiers?: number;
}

export interface PasteEvent {
  kind: "paste";
  text: string;
}

export interface MouseEvent {
  kind: "mouse";
  /** 0-based cell coordinates on the real terminal. */
  x: number;
  y: number;
  action: "press" | "release" | "drag" | "move" | "wheel-up" | "wheel-down";
  /** 0 left, 1 middle, 2 right (for press/release/drag). */
  button: number;
  shift: boolean;
  alt: boolean;
  ctrl: boolean;
  /** Raw SGR button code, needed to re-encode the event for a session. */
  code: number;
  seq: string;
}

export type InputEvent = KeyEvent | PasteEvent | MouseEvent;

const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";

const CSI_FINAL_NAMES: Record<string, string> = {
  A: "up",
  B: "down",
  C: "right",
  D: "left",
  H: "home",
  F: "end",
  Z: "backtab",
  P: "f1",
  Q: "f2",
  R: "f3",
  S: "f4",
};

const TILDE_NAMES: Record<string, string> = {
  "1": "home",
  "2": "insert",
  "3": "delete",
  "4": "end",
  "5": "pageup",
  "6": "pagedown",
  "7": "home",
  "8": "end",
  "11": "f1",
  "12": "f2",
  "13": "f3",
  "14": "f4",
  "15": "f5",
  "17": "f6",
  "18": "f7",
  "19": "f8",
  "20": "f9",
  "21": "f10",
  "23": "f11",
  "24": "f12",
};

function modifierPrefix(param: string | undefined): string {
  const value = Number(param ?? "1") - 1;
  if (!Number.isFinite(value) || value <= 0) return "";
  let prefix = "";
  if (value & 4) prefix += "C-";
  if (value & 2) prefix += "M-";
  if (value & 1) prefix += "S-";
  return prefix;
}

function controlName(code: number): string {
  if (code === 0x00) return "C-space";
  if (code === 0x09) return "tab";
  if (code === 0x0d) return "enter";
  if (code === 0x0a) return "C-j";
  if (code === 0x1b) return "escape";
  if (code === 0x7f) return "backspace";
  if (code === 0x08) return "C-h";
  if (code >= 0x01 && code <= 0x1a) return `C-${String.fromCharCode(code + 0x60)}`;
  if (code === 0x1c) return "C-\\";
  if (code === 0x1d) return "C-]";
  if (code === 0x1e) return "C-^";
  if (code === 0x1f) return "C-_";
  return `0x${code.toString(16)}`;
}

export class InputTokenizer {
  private readonly decoder = new TextDecoder();
  private pending = "";
  private paste: string | null = null;

  push(chunk: Uint8Array | string): InputEvent[] {
    this.pending +=
      typeof chunk === "string" ? chunk : this.decoder.decode(chunk, { stream: true });
    const events: InputEvent[] = [];
    let text = this.pending;
    this.pending = "";
    let i = 0;
    while (i < text.length) {
      if (this.paste !== null) {
        const end = text.indexOf(PASTE_END, i);
        if (end === -1) {
          // Keep a possible partial end marker for the next read.
          const keep = partialSuffix(text.slice(i), PASTE_END);
          this.paste += text.slice(i, text.length - keep);
          this.pending = text.slice(text.length - keep);
          return events;
        }
        this.paste += text.slice(i, end);
        events.push({ kind: "paste", text: this.paste });
        this.paste = null;
        i = end + PASTE_END.length;
        continue;
      }
      const ch = text[i]!;
      if (ch !== "\x1b") {
        const code = ch.charCodeAt(0);
        if (code < 0x20 || code === 0x7f) {
          events.push({ kind: "key", name: controlName(code), seq: ch });
          i += 1;
          continue;
        }
        const point = text.codePointAt(i)!;
        const char = String.fromCodePoint(point);
        events.push({ kind: "key", name: char, seq: char });
        i += char.length;
        continue;
      }
      // Escape sequences.
      if (i + 1 >= text.length) {
        events.push({ kind: "key", name: "escape", seq: "\x1b" });
        i += 1;
        continue;
      }
      const next = text[i + 1]!;
      if (next === "\x1b") {
        events.push({ kind: "key", name: "escape", seq: "\x1b" });
        i += 1;
        continue;
      }
      if (next === "\x07") {
        events.push({ kind: "key", name: "C-g", seq: "\x1b\x07" });
        i += 2;
        continue;
      }
      if (next === "[") {
        const match = /^\x1b\[([<?]?)([\d;:]*)([\x20-\x2f]*)([\x40-\x7e])/.exec(text.slice(i));
        if (!match) {
          if (/^\x1b\[[<?]?[\d;:]*[\x20-\x2f]*$/.test(text.slice(i))) {
            this.pending = text.slice(i); // split sequence: wait for the rest
            return events;
          }
          events.push({ kind: "key", name: "M-[", seq: "\x1b[" });
          i += 2;
          continue;
        }
        const seq = match[0];
        i += seq.length;
        if (seq === PASTE_START) {
          this.paste = "";
          continue;
        }
        const [, marker, params, , final] = match;
        if (marker === "<" && (final === "M" || final === "m")) {
          const mouse = parseSgrMouse(params!, final === "m", seq);
          if (mouse) events.push(mouse);
          continue;
        }
        const parts = params!.split(";");
        if (final === "u") {
          if (marker === "?") continue; // response to our keyboard-status query
          const point = Number(parts[0]?.split(":")[0]);
          const modifiers = Number(parts[1]?.split(":")[0] ?? "1");
          if (!Number.isInteger(point) || point < 0 || point > 0x10ffff) continue;
          const base =
            point <= 0x1f || point === 0x7f ? controlName(point) : String.fromCodePoint(point);
          const name =
            modifiers === 5 && point === 32 ? "C-space" : modifierPrefix(String(modifiers)) + base;
          events.push({
            kind: "key",
            name,
            seq,
            protocol: "csi-u",
            codepoint: point,
            modifiers,
          });
        } else if (final === "~") {
          const base = TILDE_NAMES[parts[0] ?? ""] ?? `csi-${params}~`;
          events.push({
            kind: "key",
            name: modifierPrefix(parts[1]) + base,
            seq,
          });
        } else if (CSI_FINAL_NAMES[final!]) {
          events.push({
            kind: "key",
            name: modifierPrefix(parts[1]) + CSI_FINAL_NAMES[final!],
            seq,
          });
        } else {
          events.push({
            kind: "key",
            name: `csi-${marker}${params}${final}`,
            seq,
          });
        }
        continue;
      }
      if (next === "O") {
        if (i + 2 >= text.length) {
          this.pending = text.slice(i);
          return events;
        }
        const final = text[i + 2]!;
        const seq = text.slice(i, i + 3);
        events.push({
          kind: "key",
          name: CSI_FINAL_NAMES[final] ?? `ss3-${final}`,
          seq,
        });
        i += 3;
        continue;
      }
      // Meta / Alt + key.
      const point = text.codePointAt(i + 1)!;
      const char = String.fromCodePoint(point);
      const code = char.charCodeAt(0);
      const base = code < 0x20 || code === 0x7f ? controlName(code) : char;
      events.push({ kind: "key", name: `M-${base}`, seq: `\x1b${char}` });
      i += 1 + char.length;
    }
    return events;
  }
}

function partialSuffix(text: string, marker: string): number {
  for (let length = Math.min(marker.length - 1, text.length); length > 0; length--) {
    if (marker.startsWith(text.slice(text.length - length))) return length;
  }
  return 0;
}

function parseSgrMouse(params: string, release: boolean, seq: string): MouseEvent | null {
  const [codeText, xText, yText] = params.split(";");
  const code = Number(codeText);
  const x = Number(xText) - 1;
  const y = Number(yText) - 1;
  if (![code, x, y].every(Number.isFinite)) return null;
  const base = code & 0b11;
  const motion = (code & 32) !== 0;
  const wheel = (code & 64) !== 0;
  let action: MouseEvent["action"];
  if (wheel) action = base === 0 ? "wheel-up" : "wheel-down";
  else if (release) action = "release";
  else if (motion) action = base === 3 ? "move" : "drag";
  else action = "press";
  return {
    kind: "mouse",
    x,
    y,
    action,
    button: base,
    shift: (code & 4) !== 0,
    alt: (code & 8) !== 0,
    ctrl: (code & 16) !== 0,
    code,
    seq,
  };
}

/** Navigation keys understood by browser overlays (and the install-review reducer). */
export type NavKey =
  | "up"
  | "down"
  | "left"
  | "right"
  | "tab"
  | "enter"
  | "escape"
  | "pageup"
  | "pagedown"
  | "home"
  | "end"
  | "backspace"
  | { digit: number }
  | { char: string }
  | null;

export function navKeyOf(event: KeyEvent): NavKey {
  switch (event.name) {
    case "up":
    case "down":
    case "left":
    case "right":
    case "tab":
    case "enter":
    case "escape":
    case "pageup":
    case "pagedown":
    case "home":
    case "end":
    case "backspace":
      return event.name;
    case "C-h":
      return "backspace";
    case "C-p":
      return "up";
    case "C-n":
      return "down";
  }
  if ([...event.name].length === 1 && event.name >= " ") {
    if (event.name >= "1" && event.name <= "9") return { digit: Number(event.name) };
    return { char: event.name };
  }
  return null;
}
