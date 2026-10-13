import type { RpcClient } from "@vibestudio/rpc";
import { createExtensionsClient } from "@vibestudio/extension";
import type { Api as ShellApi } from "@workspace-extensions/shell";
import {
  PtyStreamAcknowledger,
  PtyStreamCursor,
  readPtyStream,
  type PtyStreamEvent,
} from "@workspace/pty-stream";
import { VtGrid } from "../compositor/vtGrid.js";
import type { TerminalSessionEntry } from "./launcher.js";

/** The shell-extension calls a tab makes on its PTY session. */
export type ShellClient = Pick<ShellApi, "attach" | "acknowledge" | "write" | "resize">;

export const SHELL_EXTENSION = "@workspace-extensions/shell";

/** The shell extension in the shown workspace, as this person. */
export function shellClient(rpc: RpcClient): ShellClient {
  return createExtensionsClient(rpc).use(SHELL_EXTENSION) as ShellClient;
}

export function describeExit(exit: { code: number | null; signal?: string }): string {
  if (exit.signal) return `stopped by ${exit.signal}`;
  return exit.code === null ? "exited" : `exited (code ${exit.code})`;
}

export interface TerminalSize {
  columns: number;
  rows: number;
}

export type SessionStatus =
  | { kind: "attaching" }
  | { kind: "live" }
  /** The attachment ended without the program exiting (transport or server). */
  | { kind: "disconnected"; reason: string }
  /** The program is not running (it exited, or was never relaunched); the tab stays until closed. */
  | { kind: "exited"; code: number | null; signal?: string }
  | { kind: "error"; message: string };

export interface SessionEvents {
  /** Status, title or attention changed. */
  changed(): void;
  /** The grid shows new output. */
  output(): void;
  /** The program rang the bell (BEL). */
  bell(session: ShellSessionTab): void;
  /** The program asked to put text on the person's clipboard (OSC 52). */
  copy(session: ShellSessionTab, text: string): void;
  log(level: "info" | "warn" | "error", message: string): void;
}

const MAX_TITLE_LENGTH = 80;

/**
 * One tab: a terminal session of the person's (a terminal app or a shell),
 * attached to its PTY in the shown workspace through the shell extension.
 * Output bytes go into the tab's grid (never to the real TTY); keys, pastes
 * and resizes go back with `write`/`resize`. Standard control sequences the
 * program emits become browser chrome: OSC 0/2 title, BEL and OSC 9/777
 * attention, OSC 8 links, OSC 52 copy, focus reports (CSI ?1004).
 *
 * A fresh attach replays the retained output into a clean grid; a resuming
 * attach (after a lost connection) continues exactly after the last byte this
 * tab received. Either way the PTY is sized to the tab, so a full-screen
 * program redraws for it.
 */
export class ShellSessionTab {
  readonly grid: VtGrid;
  status: SessionStatus = { kind: "attaching" };
  /** Why a background tab wants the person (bell, OSC 9/777 notification). */
  attention: string | null = null;
  entry: TerminalSessionEntry;

  private attachment: AbortController | null = null;
  private readonly cursor = new PtyStreamCursor();
  private acknowledger: PtyStreamAcknowledger | null = null;
  private inputInFlight: Promise<void> | null = null;
  private queuedInput = "";
  private latestSize: TerminalSize;
  private resizeInFlight = false;
  private resizeQueued = false;
  private focused = false;
  private programTitle: string | null = null;

  constructor(
    private readonly shell: ShellClient,
    entry: TerminalSessionEntry,
    viewport: TerminalSize,
    private readonly events: SessionEvents
  ) {
    this.entry = entry;
    this.latestSize = { ...viewport };
    this.grid = new VtGrid(viewport, {
      signals: {
        title: (title) => {
          this.programTitle = cleanText(title) || null;
          this.events.changed();
        },
        attention: (message) => this.requestAttention(cleanText(message) || "needs your attention"),
        copy: (text) => this.events.copy(this, text),
      },
    });
    this.grid.onBell(() => {
      this.requestAttention("bell");
      this.events.bell(this);
    });
  }

  /** The person's terminal session (registry id; stable across relaunches). */
  get sessionId(): string {
    return this.entry.sessionId;
  }

  /** The program's own title (OSC 0/2), else the session's title. */
  get title(): string {
    return this.programTitle ?? this.entry.title;
  }

  isLive(): boolean {
    return this.status.kind === "live";
  }

  /**
   * Take a newer description of the session. Returns true when it now runs in
   * a different PTY (it was relaunched), which needs a fresh attach.
   */
  updateEntry(entry: TerminalSessionEntry): boolean {
    const relaunched = entry.shellSessionId !== this.entry.shellSessionId;
    this.entry = entry;
    if (relaunched) this.programTitle = null;
    // The attach stream reports an exit itself; this covers a tab that is not attached.
    if (!entry.running && !this.attachment && this.status.kind !== "exited") {
      this.status = exitedStatus(entry);
    }
    this.events.changed();
    return relaunched;
  }

  /**
   * Attach to the session's PTY. `fresh` starts from a clean grid with a full
   * replay; otherwise the attachment resumes after the last received byte.
   */
  async attach(focused: boolean, fresh: boolean): Promise<void> {
    this.detach();
    this.focused = focused;
    const shellSessionId = this.entry.shellSessionId;
    if (!shellSessionId) {
      this.setStatus(exitedStatus(this.entry));
      return;
    }
    const controller = new AbortController();
    this.attachment = controller;
    const after = fresh ? undefined : this.cursor.resumeAfter();
    if (!after) {
      this.cursor.forget();
      this.grid.reset();
      this.events.output();
    }
    this.setStatus({ kind: "attaching" });
    try {
      const response = await this.shell.attach(shellSessionId, {
        ...(after ? { after } : {}),
        size: { cols: this.latestSize.columns, rows: this.latestSize.rows },
      });
      if (controller.signal.aborted) {
        void response.body?.cancel().catch(() => {});
        return;
      }
      if (!response.body) throw new Error("the shell returned no output stream");
      await this.read(shellSessionId, readPtyStream(response.body, controller.signal), controller);
    } catch (error) {
      if (controller.signal.aborted) return;
      this.setStatus({ kind: "error", message: describeError(error) });
      this.events.log("error", `${this.title}: ${describeError(error)}`);
    } finally {
      if (this.attachment === controller) this.attachment = null;
    }
  }

  private async read(
    shellSessionId: string,
    stream: AsyncGenerator<PtyStreamEvent, void, undefined>,
    controller: AbortController
  ): Promise<void> {
    let exited = false;
    for await (const event of stream) {
      if (controller.signal.aborted) return;
      this.cursor.apply(event);
      switch (event.kind) {
        case "hello":
          this.acknowledger = new PtyStreamAcknowledger(
            (bytes) => this.shell.acknowledge(shellSessionId, event.attachId, bytes),
            (error) =>
              this.events.log(
                "warn",
                `${this.title}: output acknowledgement failed: ${describeError(error)}`
              )
          );
          this.setStatus({ kind: "live" });
          break;
        case "data": {
          const acknowledger = this.acknowledger;
          const bytes = event.bytes.byteLength;
          void this.grid.write(event.bytes).then(() => {
            acknowledger?.consumed(bytes);
            this.events.output();
          });
          break;
        }
        case "reset":
          void this.grid.resetInOrder().then(() => this.events.output());
          break;
        case "gap":
          void this.grid
            .write(
              `\r\n\x1b[2m[${event.to - event.from} bytes of earlier output were trimmed]\x1b[0m\r\n`
            )
            .then(() => this.events.output());
          break;
        case "exit":
          exited = true;
          this.setStatus({
            kind: "exited",
            code: event.code,
            ...(event.signal ? { signal: event.signal } : {}),
          });
          break;
      }
    }
    if (controller.signal.aborted || exited) return;
    this.setStatus({ kind: "disconnected", reason: "the connection to the session ended" });
  }

  /** Stop receiving output; the program keeps running and can be resumed. */
  detach(): void {
    const attachment = this.attachment;
    this.attachment = null;
    attachment?.abort();
    this.acknowledger = null;
    this.queuedInput = "";
  }

  /** Send input in order; input typed while a send is in flight goes out as one batch after it. */
  sendInput(data: string): void {
    if (!this.isLive() || data.length === 0) return;
    this.queuedInput += data;
    if (this.inputInFlight) return;
    this.inputInFlight = this.flushInput().finally(() => {
      this.inputInFlight = null;
    });
  }

  private async flushInput(): Promise<void> {
    while (this.queuedInput && this.isLive() && this.entry.shellSessionId) {
      const data = this.queuedInput;
      this.queuedInput = "";
      try {
        await this.shell.write(this.entry.shellSessionId, data);
      } catch (error) {
        this.queuedInput = "";
        if (!this.attachment) return; // detached meanwhile
        this.setStatus({ kind: "error", message: `input was not delivered: ${describeError(error)}` });
        return;
      }
    }
  }

  resize(size: TerminalSize): void {
    this.latestSize = { ...size };
    this.grid.resize(size);
    if (!this.isLive()) return; // the next attach sends the size
    if (this.resizeInFlight) {
      this.resizeQueued = true;
      return;
    }
    this.resizeInFlight = true;
    void (async () => {
      try {
        do {
          this.resizeQueued = false;
          const shellSessionId = this.entry.shellSessionId;
          if (!shellSessionId) return;
          await this.shell.resize(shellSessionId, this.latestSize.columns, this.latestSize.rows);
        } while (this.resizeQueued && this.isLive());
      } catch (error) {
        if (this.attachment)
          this.events.log("warn", `${this.title}: resize failed: ${describeError(error)}`);
      } finally {
        this.resizeInFlight = false;
      }
    })();
  }

  setFocused(focused: boolean): void {
    if (this.focused === focused) return;
    this.focused = focused;
    if (focused && this.attention) {
      this.attention = null;
      this.events.changed();
    }
    // Focus reporting (CSI ?1004): tell the program when its tab gains or loses focus.
    const shellSessionId = this.entry.shellSessionId;
    if (shellSessionId && this.isLive() && this.grid.reportsFocus()) {
      void this.shell
        .write(shellSessionId, focused ? "\x1b[I" : "\x1b[O")
        .catch((error: unknown) =>
          this.events.log("warn", `${this.title}: focus report failed: ${describeError(error)}`)
        );
    }
  }

  dispose(): void {
    this.detach();
    this.grid.dispose();
  }

  private requestAttention(reason: string): void {
    if (this.focused) return;
    this.attention = reason;
    this.events.changed();
  }

  private setStatus(status: SessionStatus): void {
    this.status = status;
    this.events.changed();
  }
}

function exitedStatus(entry: TerminalSessionEntry): SessionStatus {
  return {
    kind: "exited",
    code: entry.exit?.code ?? null,
    ...(entry.exit?.signal ? { signal: entry.exit.signal } : {}),
  };
}

export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function cleanText(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\x00-\x1f\x7f-\x9f]+/g, " ").trim().slice(0, MAX_TITLE_LENGTH);
}
