import { EventEmitter } from "node:events";
import type React from "react";
import { render, type Instance } from "ink";
import { VtGrid, type GridSize } from "./vtGrid.js";

/** The stdout an Ink chrome layer renders into: every write is one complete frame. */
class FrameStdout extends EventEmitter {
  readonly isTTY = true;
  constructor(
    public columns: number,
    public rows: number,
    private readonly onFrame: (frame: string) => void
  ) {
    super();
  }
  write(chunk: string | Uint8Array, encodingOrCallback?: unknown, callback?: () => void): boolean {
    this.onFrame(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk));
    const done = typeof encodingOrCallback === "function" ? encodingOrCallback : callback;
    if (typeof done === "function") queueMicrotask(done as () => void);
    return true;
  }
}

/** Ink never reads input in chrome layers; the browser routes keys itself. */
class InertStdin extends EventEmitter {
  readonly isTTY = false;
  setRawMode(): this {
    return this;
  }
  setEncoding(): this {
    return this;
  }
  read(): null {
    return null;
  }
  ref(): this {
    return this;
  }
  unref(): this {
    return this;
  }
  resume(): this {
    return this;
  }
  pause(): this {
    return this;
  }
}

/**
 * Browser chrome (tab strip, status bar, overlays) as an Ink tree rendered
 * into its own headless VT layer. Ink runs in debug mode, which renders
 * synchronously on every update and writes each complete frame; the frame
 * replaces the layer's grid. The compositor then copies the grid like any
 * session grid, so chrome and sessions share one paint path.
 */
export class InkLayer {
  readonly grid: VtGrid;
  private readonly stdout: FrameStdout;
  private instance: Instance | null = null;
  private written: Promise<void> = Promise.resolve();

  constructor(
    size: GridSize,
    private readonly onChange: () => void
  ) {
    this.grid = new VtGrid(size, { scrollback: 0 });
    this.stdout = new FrameStdout(size.columns, size.rows, (frame) => {
      // Home + clear, then the frame. Lines never exceed the layer, so nothing scrolls.
      this.written = this.grid.write(`\x1b[H\x1b[2J\x1b[0m${frame}`).then(this.onChange);
    });
  }

  get size(): GridSize {
    return { columns: this.grid.columns, rows: this.grid.rows };
  }

  /** Render (or re-render) the layer's tree. */
  update(element: React.ReactElement): void {
    if (!this.instance) {
      this.instance = render(element, {
        stdout: this.stdout as unknown as NodeJS.WriteStream,
        stderr: this.stdout as unknown as NodeJS.WriteStream,
        stdin: new InertStdin() as unknown as NodeJS.ReadStream,
        debug: true,
        exitOnCtrlC: false,
        patchConsole: false,
      });
    } else {
      this.instance.rerender(element);
    }
  }

  resize(size: GridSize): void {
    if (size.columns === this.grid.columns && size.rows === this.grid.rows) return;
    this.stdout.columns = size.columns;
    this.stdout.rows = size.rows;
    this.grid.resize(size);
  }

  /** Resolves when the latest frame is in the grid. */
  settled(): Promise<void> {
    return this.written;
  }

  dispose(): void {
    this.instance?.unmount();
    this.instance = null;
    this.grid.dispose();
  }
}
