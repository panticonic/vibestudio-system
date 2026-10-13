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

/** What a program asked its terminal for through standard control sequences. */
export interface GridSignals {
  /** OSC 0 / OSC 2: window title. */
  title?(title: string): void;
  /** OSC 9 or OSC 777;notify: a notification asking for the person's attention. */
  attention?(message: string): void;
  /** OSC 52: put text on the person's clipboard. */
  copy?(text: string): void;
}

/** A hyperlink drawn with OSC 8, anchored to its buffer line by a marker (survives scrolling). */
interface PlacedLink {
  url: string;
  buffer: "normal" | "alternate";
  line: import("@xterm/headless").IMarker;
  x1: number;
  x2: number;
}

/** Links remembered per grid, for clicking and for the links list. */
const MAX_TRACKED_LINKS = 200;

/**
 * One headless VT emulator. Sessions render their output into one; the
 * browser's Ink chrome renders into others. The compositor copies grids into
 * its frame with `paint`. Also tracks the private modes that the browser must
 * honour on the session's behalf (cursor visibility, SGR mouse encoding, focus
 * reporting) and surfaces the standard requests a program makes of its
 * terminal (title, attention, clipboard, hyperlinks).
 */
export class VtGrid {
  private readonly term: HeadlessTerminal;
  private size: GridSize;
  private cursorHidden = false;
  private sgrMouse = false;
  private focusReporting = false;
  private openLink: { url: string; y: number; x: number } | null = null;
  private readonly placedLinks: PlacedLink[] = [];
  /** URLs in the order they were last drawn, most recent last, without duplicates. */
  private readonly recentUrls: string[] = [];
  private readonly cell: BufferCell;
  private readonly bellListeners = new Set<() => void>();
  private disposed = false;

  constructor(
    size: GridSize,
    options: { scrollback?: number; signals?: GridSignals } = {}
  ) {
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
        if (param === 1004) this.focusReporting = set;
      }
      return false; // let xterm apply the mode too
    };
    this.term.parser.registerCsiHandler({ prefix: "?", final: "h" }, (p) =>
      trackPrivateMode(p, true)
    );
    this.term.parser.registerCsiHandler({ prefix: "?", final: "l" }, (p) =>
      trackPrivateMode(p, false)
    );
    // RIS (ESC c), from the program or `resetInOrder`, clears what we track too.
    this.term.parser.registerEscHandler({ final: "c" }, () => {
      this.forgetModes();
      return false; // let xterm reset itself
    });
    this.term.onBell(() => {
      for (const listener of [...this.bellListeners]) listener();
    });
    const signals = options.signals ?? {};
    this.term.onTitleChange((title) => signals.title?.(title));
    this.term.parser.registerOscHandler(9, (data) => {
      // OSC 9;4 is a progress report (ConEmu), not a notification.
      if (!/^4;/.test(data)) signals.attention?.(data);
      return true;
    });
    this.term.parser.registerOscHandler(777, (data) => {
      const [kind, title, body] = data.split(";");
      if (kind === "notify") signals.attention?.([title, body].filter(Boolean).join(": "));
      return true;
    });
    this.term.parser.registerOscHandler(52, (data) => {
      const payload = data.slice(data.indexOf(";") + 1);
      if (payload === "?") return true; // clipboard reads are never answered
      try {
        signals.copy?.(Buffer.from(payload, "base64").toString("utf8"));
      } catch {
        // Malformed base64: nothing to copy.
      }
      return true;
    });
    this.term.parser.registerOscHandler(8, (data) => {
      // OSC 8 ; params ; URI — a non-empty URI opens a link, an empty one closes it.
      const url = data.slice(data.indexOf(";") + 1);
      const buffer = this.term.buffer.active;
      const here = { y: buffer.baseY + buffer.cursorY, x: buffer.cursorX };
      const open = this.openLink;
      if (open && open.y === here.y && here.x > open.x) this.placeLink(open.url, open.x, here.x - 1);
      this.openLink = url ? { url, y: here.y, x: here.x } : null;
      return true;
    });
  }

  private placeLink(url: string, x1: number, x2: number): void {
    const known = this.recentUrls.indexOf(url);
    if (known !== -1) this.recentUrls.splice(known, 1);
    this.recentUrls.push(url);
    if (this.recentUrls.length > MAX_TRACKED_LINKS) this.recentUrls.shift();
    const line = this.term.registerMarker(0);
    if (!line) return;
    this.placedLinks.push({ url, buffer: this.term.buffer.active.type, line, x1, x2 });
    if (this.placedLinks.length > MAX_TRACKED_LINKS) this.placedLinks.shift()!.line.dispose();
  }

  private forgetLinks(): void {
    this.openLink = null;
    for (const link of this.placedLinks) link.line.dispose();
    this.placedLinks.length = 0;
    this.recentUrls.length = 0;
  }

  get columns(): number {
    return this.size.columns;
  }

  get rows(): number {
    return this.size.rows;
  }

  /** Feed output (text or raw bytes); resolves once the grid reflects it. */
  write(data: string | Uint8Array): Promise<void> {
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
    this.forgetModes();
  }

  private forgetModes(): void {
    this.cursorHidden = false;
    this.sgrMouse = false;
    this.focusReporting = false;
    this.forgetLinks();
  }

  /**
   * Reset in order with output already written (RIS through the write queue),
   * for a session whose scrollback was cleared while output is in flight.
   */
  resetInOrder(): Promise<void> {
    return this.write("\x1bc");
  }

  /** Whether the program asked for focus in/out reports (CSI ?1004). */
  reportsFocus(): boolean {
    return this.focusReporting;
  }

  /** The URL of the OSC 8 link drawn at an absolute buffer position, if any. */
  linkAt(x: number, y: number): string | null {
    const buffer = this.term.buffer.active.type;
    for (let i = this.placedLinks.length - 1; i >= 0; i--) {
      const link = this.placedLinks[i]!;
      if (link.buffer !== buffer || link.line.isDisposed) continue;
      if (link.line.line === y && x >= link.x1 && x <= link.x2) return link.url;
    }
    return null;
  }

  /** URLs of the OSC 8 links the program drew, most recent first, without duplicates. */
  links(): string[] {
    return [...this.recentUrls].reverse();
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
