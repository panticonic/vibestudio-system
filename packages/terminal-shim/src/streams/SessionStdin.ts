import { EventEmitter } from "node:events";

/**
 * The stdin Ink reads keys from for one attachment. Ink 6 attaches a
 * `readable` listener and drains `read()`; the browser's routed input bytes
 * are queued here and announced with `readable`. Raw mode is a no-op: the
 * browser owns the real terminal and always forwards raw bytes.
 */
export class SessionStdin extends EventEmitter {
  readonly isTTY = true as const;
  isRaw = false;
  readable = true;
  destroyed = false;

  private readonly queue: string[] = [];

  setRawMode(enabled: boolean): this {
    this.isRaw = enabled;
    return this;
  }
  setEncoding(): this {
    return this;
  }
  resume(): this {
    return this;
  }
  pause(): this {
    return this;
  }
  ref(): this {
    return this;
  }
  unref(): this {
    return this;
  }

  read(): string | null {
    return this.queue.shift() ?? null;
  }

  /** Deliver browser-routed input to Ink. */
  deliver(data: string): void {
    if (this.destroyed || data.length === 0) return;
    this.queue.push(data);
    this.emit("readable");
  }

  destroy(): void {
    this.destroyed = true;
    this.queue.length = 0;
  }
}
