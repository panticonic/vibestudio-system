/**
 * The compositor's cell model and the diff painter that turns two frames into
 * the minimal bytes for the real terminal.
 */

export const ATTR_BOLD = 1;
export const ATTR_DIM = 2;
export const ATTR_ITALIC = 4;
export const ATTR_UNDERLINE = 8;
export const ATTR_BLINK = 16;
export const ATTR_INVERSE = 32;
export const ATTR_INVISIBLE = 64;
export const ATTR_STRIKE = 128;
export const ATTR_OVERLINE = 256;

/** Color encoding: -1 default, 0..255 palette, RGB_FLAG | 0xRRGGBB truecolor. */
export const DEFAULT_COLOR = -1;
export const RGB_FLAG = 0x1000000;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CellStyle {
  fg?: number;
  bg?: number;
  attrs?: number;
}

export interface CursorState {
  x: number;
  y: number;
  visible: boolean;
}

/** A grid of cells. A width-2 cell is followed by a width-0 placeholder. */
export class Screen {
  readonly chars: string[];
  readonly widths: Uint8Array;
  readonly fg: Int32Array;
  readonly bg: Int32Array;
  readonly attrs: Uint16Array;

  constructor(
    readonly columns: number,
    readonly rows: number
  ) {
    const size = columns * rows;
    this.chars = new Array<string>(size).fill(" ");
    this.widths = new Uint8Array(size).fill(1);
    this.fg = new Int32Array(size).fill(DEFAULT_COLOR);
    this.bg = new Int32Array(size).fill(DEFAULT_COLOR);
    this.attrs = new Uint16Array(size);
  }

  index(x: number, y: number): number {
    return y * this.columns + x;
  }

  set(
    x: number,
    y: number,
    char: string,
    width: number,
    fg: number,
    bg: number,
    attrs: number
  ): void {
    if (x < 0 || y < 0 || x >= this.columns || y >= this.rows) return;
    const i = this.index(x, y);
    // A wide character that would straddle the right edge cannot be shown.
    if (width === 2 && x === this.columns - 1) {
      char = " ";
      width = 1;
    }
    // Overwriting half of an existing wide character blanks its other half.
    if (this.widths[i] === 0 && x > 0) this.blank(x - 1, y);
    if (this.widths[i] === 2 && width !== 2 && x + 1 < this.columns) this.blank(x + 1, y);
    this.chars[i] = char;
    this.widths[i] = width;
    this.fg[i] = fg;
    this.bg[i] = bg;
    this.attrs[i] = attrs;
    if (width === 2) {
      const j = i + 1;
      if (this.widths[j] === 2 && x + 2 < this.columns) this.blank(x + 2, y);
      this.chars[j] = "";
      this.widths[j] = 0;
      this.fg[j] = fg;
      this.bg[j] = bg;
      this.attrs[j] = attrs;
    }
  }

  private blank(x: number, y: number): void {
    const i = this.index(x, y);
    this.chars[i] = " ";
    this.widths[i] = 1;
  }

  /** Fill a rectangle with blanks in the given style. */
  fill(rect: Rect, style: CellStyle = {}): void {
    for (let y = rect.y; y < rect.y + rect.height; y++) {
      for (let x = rect.x; x < rect.x + rect.width; x++) {
        this.set(
          x,
          y,
          " ",
          1,
          style.fg ?? DEFAULT_COLOR,
          style.bg ?? DEFAULT_COLOR,
          style.attrs ?? 0
        );
      }
    }
  }

  /** Write plain single-width text (browser messages); clipped to the row. */
  text(x: number, y: number, text: string, style: CellStyle = {}): void {
    let column = x;
    for (const char of text) {
      if (column >= this.columns) break;
      this.set(
        column,
        y,
        char,
        1,
        style.fg ?? DEFAULT_COLOR,
        style.bg ?? DEFAULT_COLOR,
        style.attrs ?? 0
      );
      column += 1;
    }
  }

  /** Swap fg/bg (inverse) over a rectangle, e.g. for a selection. */
  invert(rect: Rect): void {
    for (let y = rect.y; y < rect.y + rect.height; y++) {
      for (let x = rect.x; x < rect.x + rect.width; x++) {
        if (x < 0 || y < 0 || x >= this.columns || y >= this.rows) continue;
        const i = this.index(x, y);
        this.attrs[i] = this.attrs[i]! ^ ATTR_INVERSE;
      }
    }
  }

  /** The text of one row (for tests and copy mode). */
  rowText(y: number): string {
    let out = "";
    for (let x = 0; x < this.columns; x++) out += this.chars[this.index(x, y)]!;
    return out.replace(/\s+$/, "");
  }

  sameCell(other: Screen, i: number): boolean {
    return (
      this.chars[i] === other.chars[i] &&
      this.widths[i] === other.widths[i] &&
      this.fg[i] === other.fg[i] &&
      this.bg[i] === other.bg[i] &&
      this.attrs[i] === other.attrs[i]
    );
  }
}

const BSU = "\x1b[?2026h";
const ESU = "\x1b[?2026l";

function colorParams(color: number, background: boolean): string {
  if (color === DEFAULT_COLOR) return background ? "49" : "39";
  if (color & RGB_FLAG) {
    const rgb = color & 0xffffff;
    return `${background ? 48 : 38};2;${(rgb >> 16) & 255};${(rgb >> 8) & 255};${rgb & 255}`;
  }
  if (color < 8) return String((background ? 40 : 30) + color);
  if (color < 16) return String((background ? 100 : 90) + color - 8);
  return `${background ? 48 : 38};5;${color}`;
}

function sgr(fg: number, bg: number, attrs: number): string {
  const params = ["0"];
  if (attrs & ATTR_BOLD) params.push("1");
  if (attrs & ATTR_DIM) params.push("2");
  if (attrs & ATTR_ITALIC) params.push("3");
  if (attrs & ATTR_UNDERLINE) params.push("4");
  if (attrs & ATTR_BLINK) params.push("5");
  if (attrs & ATTR_INVERSE) params.push("7");
  if (attrs & ATTR_INVISIBLE) params.push("8");
  if (attrs & ATTR_STRIKE) params.push("9");
  if (attrs & ATTR_OVERLINE) params.push("53");
  if (fg !== DEFAULT_COLOR) params.push(colorParams(fg, false));
  if (bg !== DEFAULT_COLOR) params.push(colorParams(bg, true));
  return `\x1b[${params.join(";")}m`;
}

/**
 * Bytes that turn the terminal's current contents (`previous`, or unknown
 * when null) into `next`, then place or hide the cursor. Returns "" when
 * nothing changed. The update is wrapped in synchronized output so terminals
 * that support DEC mode 2026 show it atomically.
 */
export function paintDiff(
  previous: Screen | null,
  next: Screen,
  cursor: CursorState,
  previousCursor: CursorState | null
): string {
  const full = !previous || previous.columns !== next.columns || previous.rows !== next.rows;
  let out = "";
  let penFg = DEFAULT_COLOR;
  let penBg = DEFAULT_COLOR;
  let penAttrs = 0;
  let cursorX = -1;
  let cursorY = -1;
  if (full) out += "\x1b[0m\x1b[2J";
  for (let y = 0; y < next.rows; y++) {
    for (let x = 0; x < next.columns; x++) {
      const i = next.index(x, y);
      const width = next.widths[i]!;
      if (width === 0) continue;
      let changed: boolean;
      if (full) {
        changed =
          next.chars[i] !== " " ||
          next.bg[i] !== DEFAULT_COLOR ||
          (next.attrs[i]! & (ATTR_INVERSE | ATTR_UNDERLINE | ATTR_STRIKE | ATTR_OVERLINE)) !== 0;
      } else {
        changed = !next.sameCell(previous!, i) || (width === 2 && !next.sameCell(previous!, i + 1));
        // A narrow cell replacing the right half of a previous wide character.
        if (!changed && x > 0 && previous!.widths[i] === 0 && next.widths[i] !== 0) changed = true;
      }
      if (!changed) continue;
      if (cursorX !== x || cursorY !== y) {
        out += `\x1b[${y + 1};${x + 1}H`;
        cursorX = x;
        cursorY = y;
      }
      const fg = next.fg[i]!;
      const bg = next.bg[i]!;
      const attrs = next.attrs[i]!;
      if (fg !== penFg || bg !== penBg || attrs !== penAttrs) {
        out += sgr(fg, bg, attrs);
        penFg = fg;
        penBg = bg;
        penAttrs = attrs;
      }
      out += next.chars[i];
      // Terminals disagree about some wide glyphs and wrap at the margin, so
      // after either the next cell is addressed explicitly.
      if (width === 2 || x + width >= next.columns) cursorX = -1;
      else cursorX += width;
    }
  }
  const cursorChanged =
    !previousCursor ||
    previousCursor.visible !== cursor.visible ||
    (cursor.visible && (previousCursor.x !== cursor.x || previousCursor.y !== cursor.y));
  if (out.length === 0 && !cursorChanged) return "";
  let tail = "";
  if (penFg !== DEFAULT_COLOR || penBg !== DEFAULT_COLOR || penAttrs !== 0) tail += "\x1b[0m";
  if (cursor.visible) tail += `\x1b[${cursor.y + 1};${cursor.x + 1}H\x1b[?25h`;
  return `${BSU}\x1b[?25l${out}${tail}${ESU}`;
}
