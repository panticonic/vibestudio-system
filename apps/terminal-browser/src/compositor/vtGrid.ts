import { Terminal } from "@xterm/headless";
import {
  ATTR_BLINK,
  ATTR_BOLD,
  ATTR_DIM,
  ATTR_INVERSE,
  ATTR_INVISIBLE,
  ATTR_ITALIC,
  ATTR_OVERLINE,
  ATTR_STRIKE,
  ATTR_UNDERLINE,
  DEFAULT_COLOR,
  RGB_FLAG,
  type Rect,
  type Screen,
} from "./screen.js";

type HeadlessTerminal = InstanceType<typeof Terminal>;
type BufferCell = import("@xterm/headless").IBufferCell;

export interface GridSize {
  columns: number;
  rows: number;
}

export interface GridPaintOptions {
  /** Lines scrolled back from the live screen (copy mode); 0 = live. */
  scrollback?: number;
  /** Selection in absolute buffer coordinates, inclusive, normalized start <= end. */
  selection?: { start: { x: number; y: number }; end: { x: number; y: number } } | null;
  /** A copy-mode cursor in absolute buffer coordinates, drawn inverse. */
  marker?: { x: number; y: number } | null;
}

/**
 * One headless VT emulator. Sessions render their output into one; the
 * browser's Ink chrome renders into others. The compositor copies grids into
 * its frame with `paint`. Also tracks the private modes that the browser must
 * honour on the session's behalf (cursor visibility, SGR mouse encoding).
 */
export class VtGrid {
  private readonly term: HeadlessTerminal;
  private size: GridSize;
  private cursorHidden = false;
  private sgrMouse = false;
  private readonly cell: BufferCell;
  private readonly bellListeners = new Set<() => void>();
  private disposed = false;

  constructor(size: GridSize, options: { scrollback?: number } = {}) {
    this.size = { ...size };
    this.term = new Terminal({
      cols: size.columns,
      rows: size.rows,
      allowProposedApi: true,
      scrollback: options.scrollback ?? 2000,
      // Ink emits bare "\n" and relies on the TTY's ONLCR translation.
      convertEol: true,
    });
    this.cell = this.term.buffer.active.getNullCell();
    const trackPrivateMode = (params: (number | number[])[], set: boolean): boolean => {
      for (const param of params) {
        if (param === 25) this.cursorHidden = !set;
        if (param === 1006) this.sgrMouse = set;
      }
      return false; // let xterm apply the mode too
    };
    this.term.parser.registerCsiHandler({ prefix: "?", final: "h" }, (p) =>
      trackPrivateMode(p, true)
    );
    this.term.parser.registerCsiHandler({ prefix: "?", final: "l" }, (p) =>
      trackPrivateMode(p, false)
    );
    this.term.onBell(() => {
      for (const listener of [...this.bellListeners]) listener();
    });
  }

  get columns(): number {
    return this.size.columns;
  }

  get rows(): number {
    return this.size.rows;
  }

  /** Feed output; resolves once the grid reflects it. */
  write(data: string): Promise<void> {
    if (this.disposed) return Promise.resolve();
    return new Promise((resolve) => this.term.write(data, resolve));
  }

  resize(size: GridSize): void {
    if (size.columns === this.size.columns && size.rows === this.size.rows) return;
    this.size = { ...size };
    this.term.resize(size.columns, size.rows);
  }

  /** Forget everything (a new attachment repaints from scratch). */
  reset(): void {
    this.term.reset();
    this.cursorHidden = false;
    this.sgrMouse = false;
  }

  onBell(listener: () => void): () => void {
    this.bellListeners.add(listener);
    return () => this.bellListeners.delete(listener);
  }

  /** Cursor in grid coordinates, as the program left it. */
  cursor(): { x: number; y: number; visible: boolean } {
    const buffer = this.term.buffer.active;
    return { x: buffer.cursorX, y: buffer.cursorY, visible: !this.cursorHidden };
  }

  /** The mouse reporting the program asked for ("none" means the browser may use the mouse). */
  mouseMode(): { tracking: "none" | "x10" | "vt200" | "drag" | "any"; sgr: boolean } {
    return { tracking: this.term.modes.mouseTrackingMode, sgr: this.sgrMouse };
  }

  bracketedPaste(): boolean {
    return this.term.modes.bracketedPasteMode;
  }

  applicationCursorKeys(): boolean {
    return this.term.modes.applicationCursorKeysMode;
  }

  /** Lines available above the live screen. */
  scrollbackLength(): number {
    return this.term.buffer.active.baseY;
  }

  /** Absolute buffer row of the live screen's top line. */
  liveTop(): number {
    return this.term.buffer.active.baseY;
  }

  /** Total buffer lines (scrollback + screen). */
  length(): number {
    return this.term.buffer.active.length;
  }

  /** Text of one absolute buffer line. */
  lineText(y: number, trimRight = true): string {
    return this.term.buffer.active.getLine(y)?.translateToString(trimRight) ?? "";
  }

  /** Copy the grid's visible window into `screen` at `rect` (clipped to both). */
  paint(screen: Screen, rect: Rect, options: GridPaintOptions = {}): void {
    const buffer = this.term.buffer.active;
    const top = buffer.baseY - Math.min(options.scrollback ?? 0, buffer.baseY);
    const rows = Math.min(rect.height, this.size.rows);
    const columns = Math.min(rect.width, this.size.columns);
    const selection = options.selection ?? null;
    for (let row = 0; row < rows; row++) {
      const absY = top + row;
      const line = buffer.getLine(absY);
      const y = rect.y + row;
      for (let column = 0; column < columns; column++) {
        const x = rect.x + column;
        const cell = line?.getCell(column, this.cell);
        if (!cell) {
          screen.set(x, y, " ", 1, DEFAULT_COLOR, DEFAULT_COLOR, 0);
          continue;
        }
        const width = cell.getWidth();
        if (width === 0) continue; // placeholder; written with its wide cell
        let attrs = attrsOf(cell);
        if (
          (selection && inSelection(column, absY, selection)) ||
          (options.marker && options.marker.x === column && options.marker.y === absY)
        ) {
          attrs ^= ATTR_INVERSE;
        }
        screen.set(x, y, cell.getChars() || " ", width, fgOf(cell), bgOf(cell), attrs);
      }
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.bellListeners.clear();
    this.term.dispose();
  }
}

function inSelection(
  x: number,
  y: number,
  selection: NonNullable<GridPaintOptions["selection"]>
): boolean {
  const { start, end } = selection;
  if (y < start.y || y > end.y) return false;
  if (y === start.y && x < start.x) return false;
  if (y === end.y && x > end.x) return false;
  return true;
}

function fgOf(cell: BufferCell): number {
  if (cell.isFgDefault()) return DEFAULT_COLOR;
  if (cell.isFgRGB()) return RGB_FLAG | cell.getFgColor();
  return cell.getFgColor();
}

function bgOf(cell: BufferCell): number {
  if (cell.isBgDefault()) return DEFAULT_COLOR;
  if (cell.isBgRGB()) return RGB_FLAG | cell.getBgColor();
  return cell.getBgColor();
}

function attrsOf(cell: BufferCell): number {
  if (cell.isAttributeDefault()) return 0;
  let attrs = 0;
  if (cell.isBold()) attrs |= ATTR_BOLD;
  if (cell.isDim()) attrs |= ATTR_DIM;
  if (cell.isItalic()) attrs |= ATTR_ITALIC;
  if (cell.isUnderline()) attrs |= ATTR_UNDERLINE;
  if (cell.isBlink()) attrs |= ATTR_BLINK;
  if (cell.isInverse()) attrs |= ATTR_INVERSE;
  if (cell.isInvisible()) attrs |= ATTR_INVISIBLE;
  if (cell.isStrikethrough()) attrs |= ATTR_STRIKE;
  if (cell.isOverline()) attrs |= ATTR_OVERLINE;
  return attrs;
}
