import { Screen, paintDiff, type CursorState } from "./screen.js";

export interface FrameSink {
  write(data: string): void;
}

/**
 * The single owner of the real terminal's screen. Producers (session grids,
 * chrome layers, state changes) call `invalidate()`; the compositor builds one
 * frame per event-loop turn (coalesced with `setImmediate`, never a timer),
 * diffs it against what the terminal shows, and writes only changed cells.
 */
export class Compositor {
  private previous: Screen | null = null;
  private previousCursor: CursorState | null = null;
  private scheduled: ReturnType<typeof setImmediate> | null = null;
  private stopped = false;
  /** Paint callbacks for tests and measurement (`painted` fires after each write). */
  private readonly paintListeners = new Set<() => void>();

  constructor(
    private readonly sink: FrameSink,
    private readonly size: () => { columns: number; rows: number },
    private readonly compose: (screen: Screen) => CursorState
  ) {}

  invalidate(): void {
    if (this.stopped || this.scheduled) return;
    this.scheduled = setImmediate(() => {
      this.scheduled = null;
      this.paint();
    });
  }

  /** Forget what the terminal shows (after resize or an external clear); next paint is full. */
  invalidateAll(): void {
    this.previous = null;
    this.previousCursor = null;
    this.invalidate();
  }

  onPainted(listener: () => void): () => void {
    this.paintListeners.add(listener);
    return () => this.paintListeners.delete(listener);
  }

  /** Build and write one frame now. */
  paint(): void {
    if (this.stopped) return;
    const { columns, rows } = this.size();
    const screen = new Screen(Math.max(1, columns), Math.max(1, rows));
    const cursor = this.compose(screen);
    const bytes = paintDiff(this.previous, screen, cursor, this.previousCursor);
    this.previous = screen;
    this.previousCursor = cursor;
    if (bytes) this.sink.write(bytes);
    for (const listener of [...this.paintListeners]) listener();
  }

  stop(): void {
    this.stopped = true;
    if (this.scheduled) clearImmediate(this.scheduled);
    this.scheduled = null;
    this.paintListeners.clear();
  }
}
