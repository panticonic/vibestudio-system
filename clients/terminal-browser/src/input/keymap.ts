import type { InputEvent } from "./tokenizer.js";

/** Prefix keys the user can choose; each is a single control byte every terminal sends. */
export const PREFIX_KEYS = [
  { id: "C-space", label: "Ctrl-Space" },
  { id: "C-a", label: "Ctrl-A" },
  { id: "C-b", label: "Ctrl-B" },
  { id: "C-]", label: "Ctrl-]" },
  { id: "C-\\", label: "Ctrl-\\" },
] as const;

export type PrefixKeyId = (typeof PREFIX_KEYS)[number]["id"];
/** Ctrl-B, as in tmux: one easy chord. Programs still get it by pressing it twice. */
export const DEFAULT_PREFIX_KEY: PrefixKeyId = "C-b";

export function isPrefixKeyId(value: unknown): value is PrefixKeyId {
  return PREFIX_KEYS.some((key) => key.id === value);
}

export function prefixLabel(id: PrefixKeyId): string {
  return PREFIX_KEYS.find((key) => key.id === id)?.label ?? id;
}

export type Command =
  | { kind: "palette" }
  | { kind: "launcher" }
  | { kind: "tab"; index: number }
  | { kind: "next-tab" }
  | { kind: "prev-tab" }
  | { kind: "last-tab" }
  | { kind: "copy-mode" }
  | { kind: "search" }
  | { kind: "links" }
  | { kind: "approvals" }
  | { kind: "logs" }
  | { kind: "help" }
  | { kind: "settings" }
  | { kind: "detach" }
  | { kind: "close" }
  | { kind: "reattach" }
  | { kind: "workspace" }
  | { kind: "quit" }
  | { kind: "cancel" }
  | { kind: "send-prefix" };

/** Where a binding is listed in the prefix menu and help. */
export type BindingGroup = "open" | "tab" | "browser";

export const BINDING_GROUPS: readonly { id: BindingGroup; title: string }[] = [
  { id: "open", title: "Open and switch" },
  { id: "tab", title: "This tab" },
  { id: "browser", title: "Browser" },
];

export interface Binding {
  /** Key after the prefix, as shown to the user. */
  key: string;
  command: Command;
  description: string;
  group: BindingGroup;
}

/** Every prefix binding. The help overlay and the palette are generated from this table. */
export const PREFIX_BINDINGS: readonly Binding[] = [
  {
    key: "k",
    command: { kind: "palette" },
    description: "Command palette: apps, sessions, actions",
    group: "open",
  },
  {
    key: "c",
    command: { kind: "launcher" },
    description: "Launcher: start an app or a shell, or resume a session",
    group: "open",
  },
  {
    key: "1-9",
    command: { kind: "tab", index: 0 },
    description: "Go to tab 1-9",
    group: "open",
  },
  { key: "n", command: { kind: "next-tab" }, description: "Next tab", group: "open" },
  { key: "p", command: { kind: "prev-tab" }, description: "Previous tab", group: "open" },
  { key: "Tab", command: { kind: "last-tab" }, description: "Last used tab", group: "open" },
  {
    key: "[",
    command: { kind: "copy-mode" },
    description: "Scroll back and copy text",
    group: "tab",
  },
  {
    key: "/",
    command: { kind: "search" },
    description: "Search retained terminal rows (literal, case-sensitive)",
    group: "tab",
  },
  {
    key: "o",
    command: { kind: "links" },
    description: "Links in this tab (open one in your browser)",
    group: "tab",
  },
  {
    key: "a",
    command: { kind: "approvals" },
    description: "Approvals waiting for you",
    group: "browser",
  },
  { key: "l", command: { kind: "logs" }, description: "Browser log", group: "browser" },
  { key: "s", command: { kind: "settings" }, description: "Settings", group: "browser" },
  {
    key: "d",
    command: { kind: "detach" },
    description: "Detach: close this tab, the program keeps running",
    group: "tab",
  },
  {
    key: "x",
    command: { kind: "close" },
    description: "End this session for good (stops the program)",
    group: "tab",
  },
  {
    key: "r",
    command: { kind: "reattach" },
    description: "Reattach this tab (restarts an app that ended)",
    group: "tab",
  },
  { key: "w", command: { kind: "workspace" }, description: "Switch workspace", group: "open" },
  {
    key: "?",
    command: { kind: "help" },
    description: "Help: every key binding",
    group: "browser",
  },
  {
    key: "q",
    command: { kind: "quit" },
    description: "Quit (programs keep running; resume them later)",
    group: "browser",
  },
];

/** How the person opens approvals with this prefix, e.g. "Ctrl-B a" (apps mention it). */
export function approvalsKeyLabel(prefix: PrefixKeyId): string {
  const binding = PREFIX_BINDINGS.find((entry) => entry.command.kind === "approvals")!;
  return `${prefixLabel(prefix)} ${binding.key}`;
}

function commandForKey(name: string, prefix: PrefixKeyId): Command | null {
  if (name === prefix) return { kind: "send-prefix" };
  if (/^[1-9]$/.test(name)) return { kind: "tab", index: Number(name) - 1 };
  if (name === "tab") return { kind: "last-tab" };
  const binding = PREFIX_BINDINGS.find((entry) => entry.key === name);
  return binding ? binding.command : null;
}

export type Routed =
  /** A prefix command. */
  | { kind: "command"; command: Command }
  /** Input for whatever has focus (a session, an overlay or the launcher). */
  | { kind: "input"; event: InputEvent }
  /** The prefix was pressed or cancelled; the status bar shows it. */
  | { kind: "prefix"; pending: boolean }
  /** A key after the prefix that means nothing; reported, never forwarded. */
  | { kind: "unbound"; key: string };

/**
 * The prefix state machine. The prefix key arms it; the next key is a
 * command (or Escape to cancel, or the prefix again to send it literally).
 * Every other key, paste and mouse report passes through untouched, so
 * sessions keep every key except the prefix itself.
 */
export class KeyRouter {
  private armed = false;

  constructor(private prefix: PrefixKeyId) {}

  get pending(): boolean {
    return this.armed;
  }

  setPrefix(prefix: PrefixKeyId): void {
    this.prefix = prefix;
    this.armed = false;
  }

  /** Disarm without a command (a click away from the prefix menu). */
  cancel(): void {
    this.armed = false;
  }

  route(events: readonly InputEvent[]): Routed[] {
    const out: Routed[] = [];
    for (const event of events) {
      if (!this.armed) {
        if (event.kind === "key" && event.name === this.prefix) {
          this.armed = true;
          out.push({ kind: "prefix", pending: true });
        } else {
          out.push({ kind: "input", event });
        }
        continue;
      }
      if (event.kind === "mouse") {
        // The armed prefix shows its menu; the browser hit-tests the click
        // against it (running the entry, or cancelling) before anything else.
        out.push({ kind: "input", event });
        continue;
      }
      if (event.kind !== "key") {
        // A paste while armed cancels the prefix and is delivered normally.
        this.armed = false;
        out.push({ kind: "prefix", pending: false }, { kind: "input", event });
        continue;
      }
      this.armed = false;
      out.push({ kind: "prefix", pending: false });
      if (event.name === "C-g") {
        out.push({ kind: "command", command: { kind: "cancel" } });
        continue;
      }
      if (event.name === "escape" || event.name === "C-c") continue;
      const command = commandForKey(event.name, this.prefix);
      out.push(command ? { kind: "command", command } : { kind: "unbound", key: event.name });
    }
    return out;
  }
}

const PREFIX_BYTES: Record<PrefixKeyId, string> = {
  "C-space": "\x00",
  "C-a": "\x01",
  "C-b": "\x02",
  "C-]": "\x1d",
  "C-\\": "\x1c",
};

/** The byte a session receives for `prefix prefix`. */
export function prefixBytes(id: PrefixKeyId): string {
  return PREFIX_BYTES[id];
}
