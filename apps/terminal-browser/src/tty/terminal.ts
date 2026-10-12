/**
 * Taking over and handing back the real terminal. Every mode the browser
 * turns on is turned off again on every exit path: a normal settle, an
 * internal error, a signal, or the process exiting underneath us.
 */

export interface TerminalStreams {
  stdin: NodeJS.ReadStream;
  stdout: NodeJS.WriteStream;
}

const ENTER =
  "\x1b[?1049h" + // alternate screen
  "\x1b[?25l" + // hide cursor until the compositor places it
  "\x1b[?2004h" + // bracketed paste
  "\x1b[?7h" + // autowrap on (diff painter addresses cells explicitly)
  "\x1b[2J";
const MOUSE_ON = "\x1b[?1000h\x1b[?1002h\x1b[?1006h";
const MOUSE_OFF = "\x1b[?1006l\x1b[?1002l\x1b[?1000l";
const LEAVE = MOUSE_OFF + "\x1b[?2004l\x1b[0m\x1b[?25h\x1b[?1049l";

export class TerminalOwnership {
  private active = false;
  private mouse = false;
  private readonly onProcessExit = () => this.release();

  constructor(private readonly streams: TerminalStreams) {}

  acquire(options: { mouse: boolean }): void {
    if (this.active) return;
    this.active = true;
    this.streams.stdin.setRawMode(true);
    this.streams.stdin.resume();
    this.streams.stdout.write(ENTER);
    this.setMouse(options.mouse);
    process.on("exit", this.onProcessExit);
  }

  /** Re-assert modes after the terminal was suspended and resumed (SIGCONT). */
  reassert(): void {
    if (!this.active) return;
    this.streams.stdin.setRawMode(true);
    this.streams.stdout.write(ENTER + (this.mouse ? MOUSE_ON : ""));
  }

  setMouse(enabled: boolean): void {
    if (!this.active) return;
    this.mouse = enabled;
    this.streams.stdout.write(enabled ? MOUSE_ON : MOUSE_OFF);
  }

  write(data: string): void {
    if (this.active) this.streams.stdout.write(data);
  }

  /** Hand the terminal back exactly as we found it. Safe to call repeatedly and synchronously. */
  release(): void {
    if (!this.active) return;
    this.active = false;
    process.off("exit", this.onProcessExit);
    try {
      this.streams.stdout.write(LEAVE);
    } finally {
      try {
        this.streams.stdin.setRawMode(false);
      } finally {
        this.streams.stdin.pause();
      }
    }
  }
}

export interface CapturedConsole {
  restore(): void;
}

/**
 * While the browser owns the screen, anything printed to the console (by
 * this process's other code, such as the RPC transport) would corrupt the
 * display. Route it into the browser's log view instead.
 */
export function captureConsole(
  sink: (level: "info" | "warn" | "error", message: string) => void
): CapturedConsole {
  const original = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
    debug: console.debug,
  };
  const format = (args: unknown[]) =>
    args
      .map((arg) =>
        arg instanceof Error ? arg.message : typeof arg === "string" ? arg : safeJson(arg)
      )
      .join(" ");
  console.log = (...args: unknown[]) => sink("info", format(args));
  console.info = (...args: unknown[]) => sink("info", format(args));
  console.debug = (...args: unknown[]) => sink("info", format(args));
  console.warn = (...args: unknown[]) => sink("warn", format(args));
  console.error = (...args: unknown[]) => sink("error", format(args));
  return {
    restore() {
      Object.assign(console, original);
    },
  };
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
