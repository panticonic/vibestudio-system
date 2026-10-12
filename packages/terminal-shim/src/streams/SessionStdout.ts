import { EventEmitter } from "node:events";

/**
 * The stdout Ink renders into for one attachment. Ink writes ANSI frames and
 * reads `columns`/`rows`/`isTTY`; it re-lays-out on `resize`. Every write goes
 * to the attachment's sink as text — there is no file descriptor.
 */
export class SessionStdout extends EventEmitter {
  readonly isTTY = true as const;
  columns: number;
  rows: number;
  writable = true;
  writableEnded = false;
  destroyed = false;
  writableLength = 0;

  private readonly decoder = new TextDecoder();

  constructor(
    private readonly sink: (text: string) => void,
    size: { columns: number; rows: number }
  ) {
    super();
    this.columns = size.columns;
    this.rows = size.rows;
  }

  write(
    chunk: string | Uint8Array,
    encodingOrCallback?: string | (() => void),
    callback?: () => void
  ): boolean {
    const done = typeof encodingOrCallback === "function" ? encodingOrCallback : callback;
    if (!this.writableEnded) {
      this.sink(typeof chunk === "string" ? chunk : this.decoder.decode(chunk, { stream: true }));
    }
    if (done) queueMicrotask(done);
    return true;
  }

  end(chunk?: string | Uint8Array): void {
    if (chunk !== undefined) this.write(chunk);
    this.writableEnded = true;
    this.emit("finish");
  }

  getColorDepth(): number {
    return 24;
  }

  hasColors(): boolean {
    return true;
  }

  /** Apply a browser resize and let Ink re-lay-out. */
  resize(size: { columns: number; rows: number }): void {
    this.columns = size.columns;
    this.rows = size.rows;
    this.emit("resize");
  }
}
