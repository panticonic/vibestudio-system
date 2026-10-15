import { withRpcAbortSignal, isRpcAbortedBy, type RpcClient } from "@vibestudio/rpc";
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
export interface ShellClient extends Pick<ShellApi, "attach" | "acknowledge" | "write" | "resize"> {
  scoped(signal: AbortSignal): ShellClient;
}

export const SHELL_EXTENSION = "@workspace-extensions/shell";

/** The shell extension in the shown workspace, as this person. */
export function shellClient(rpc: RpcClient): ShellClient {
  const api = createExtensionsClient(rpc).use(SHELL_EXTENSION);
  return {
    attach: api.attach.bind(api),
    acknowledge: api.acknowledge.bind(api),
    write: api.write.bind(api),
    resize: api.resize.bind(api),
    scoped: (signal) => shellClient(withRpcAbortSignal(rpc, signal)),
  };
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
  private activeShell: ShellClient | null = null;
  private readonly operations = new Set<Promise<unknown>>();
  private readonly retirementFailures: unknown[] = [];
  private disposed = false;
  private disposing: Promise<void> | null = null;
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
        reply: (bytes) => this.sendInput(bytes),
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
    return this.status.kind === "live" && this.attachment !== null;
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
  attach(focused: boolean, fresh: boolean): Promise<void> {
    const retired = this.detach();
    if (this.disposed) return retired;
    const controller = new AbortController();
    this.attachment = controller;
    this.activeShell = this.shell.scoped(controller.signal);
    this.setStatus({ kind: "attaching" });
    return this.track(this.attachOwned(focused, fresh, controller, retired), controller.signal);
  }

  private async attachOwned(
    focused: boolean,
    fresh: boolean,
    controller: AbortController,
    retired: Promise<void>
  ): Promise<void> {
    try {
      await retired;
    } catch (error) {
      controller.abort(error);
      if (this.attachment === controller) this.attachment = null;
      throw error;
    }
    if (controller.signal.aborted) return;
    this.focused = focused;
    const shellSessionId = this.entry.shellSessionId;
    if (!shellSessionId) {
      this.setStatus(exitedStatus(this.entry));
      if (this.attachment === controller) this.attachment = null;
      return;
    }
    const after = fresh ? undefined : this.cursor.resumeAfter();
    if (!after) {
      this.cursor.forget();
      this.grid.reset();
      this.events.output();
    }
    this.setStatus({ kind: "attaching" });
    try {
      const response = await this.activeShell!.attach(shellSessionId, {
        ...(after ? { after } : {}),
        size: { cols: this.latestSize.columns, rows: this.latestSize.rows },
      });
      if (controller.signal.aborted) {
        await response.body?.cancel(controller.signal.reason);
        return;
      }
      if (!response.body) throw new Error("the shell returned no output stream");
      await this.read(shellSessionId, readPtyStream(response.body, controller.signal), controller);
    } catch (error) {
      if (controller.signal.aborted && isRpcAbortedBy(error, controller.signal.reason)) return;
      if (controller.signal.aborted) throw error;
      this.setStatus({ kind: "error", message: describeError(error) });
      this.events.log("error", `${this.title}: ${describeError(error)}`);
    } finally {
      this.acknowledger?.flush();
      await this.acknowledger?.settled();
      if (this.attachment === controller) this.attachment = null;
    }
  }

  private async read(
    shellSessionId: string,
    stream: AsyncGenerator<PtyStreamEvent, void, undefined>,
    controller: AbortController
  ): Promise<void> {
    let exited = false;
    const shell = this.activeShell!;
    for await (const event of stream) {
      if (controller.signal.aborted) return;
      this.cursor.apply(event);
      switch (event.kind) {
        case "hello":
          this.acknowledger = new PtyStreamAcknowledger(
            (bytes) => shell.acknowledge(shellSessionId, event.attachId, bytes),
            (error) => {
              if (controller.signal.aborted && isRpcAbortedBy(error, controller.signal.reason))
                return;
              this.retirementFailures.push(error);
              this.setStatus({
                kind: "error",
                message: `Output acknowledgement failed: ${describeError(error)}`,
              });
              controller.abort(error);
              this.events.log(
                "warn",
                `${this.title}: output acknowledgement failed: ${describeError(error)}`
              );
            }
          );
          this.setStatus({ kind: "live" });
          break;
        case "data": {
          const acknowledger = this.acknowledger;
          const bytes = event.bytes.byteLength;
          await this.grid.write(event.bytes);
          acknowledger?.consumed(bytes);
          this.events.output();
          break;
        }
        case "reset":
          await this.grid.resetInOrder();
          this.events.output();
          break;
        case "gap":
          await this.grid.write(
            `\r\n\x1b[2m[${event.to - event.from} bytes of earlier output were trimmed]\x1b[0m\r\n`
          );
          this.events.output();
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
    this.setStatus({
      kind: "disconnected",
      reason: "the connection to the session ended",
    });
  }

  /** Stop receiving output; the program keeps running and can be resumed. */
  detach(): Promise<void> {
    const attachment = this.attachment;
    this.attachment = null;
    attachment?.abort(new Error("Terminal attachment detached"));
    if (attachment && this.entry.running && !this.disposed)
      this.setStatus({ kind: "disconnected", reason: "the attachment was detached" });
    this.queuedInput = "";
    return Promise.allSettled([...this.operations]).then(() => {
      if (this.retirementFailures.length)
        throw new AggregateError(
          [...this.retirementFailures],
          "Terminal attachment retirement failed"
        );
    });
  }

  /** Send input in order; input typed while a send is in flight goes out as one batch after it. */
  sendInput(data: string): void {
    if (data.length === 0) return;
    if (!this.isLive() || !this.attachment || this.disposed) {
      this.events.log("warn", `${this.title}: input was not sent (${this.status.kind})`);
      return;
    }
    this.queuedInput += data;
    if (this.inputInFlight) return;
    this.inputInFlight = this.track(this.flushInput(), this.attachment.signal).finally(() => {
      this.inputInFlight = null;
    });
    void this.inputInFlight.catch((error) =>
      this.events.log("error", `${this.title}: ${describeError(error)}`)
    );
  }

  private async flushInput(): Promise<void> {
    const owner = this.attachment!;
    const shell = this.activeShell!;
    while (this.queuedInput && this.isLive() && this.entry.shellSessionId) {
      const data = this.queuedInput;
      this.queuedInput = "";
      try {
        await shell.write(this.entry.shellSessionId, data);
      } catch (error) {
        this.queuedInput = "";
        if (owner.signal.aborted) {
          if (isRpcAbortedBy(error, owner.signal.reason)) return;
          throw error;
        }
        this.setStatus({
          kind: "error",
          message: `input was not delivered: ${describeError(error)}`,
        });
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
    const signal = this.attachment?.signal;
    const shell = this.activeShell!;
    void this.track(
      (async () => {
        try {
          do {
            this.resizeQueued = false;
            const shellSessionId = this.entry.shellSessionId;
            if (!shellSessionId) return;
            await shell.resize(shellSessionId, this.latestSize.columns, this.latestSize.rows);
          } while (this.resizeQueued && this.isLive());
        } catch (error) {
          if (signal?.aborted) {
            if (isRpcAbortedBy(error, signal.reason)) return;
            throw error;
          }
          this.events.log("warn", `${this.title}: resize failed: ${describeError(error)}`);
        } finally {
          this.resizeInFlight = false;
        }
      })(),
      signal
    );
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
      const signal = this.attachment?.signal;
      void this.track(
        this.activeShell!.write(shellSessionId, focused ? "\x1b[I" : "\x1b[O").catch(
          (error: unknown) => {
            if (signal?.aborted) {
              if (isRpcAbortedBy(error, signal.reason)) return;
              throw error;
            }
            this.events.log("warn", `${this.title}: focus report failed: ${describeError(error)}`);
          }
        ),
        signal
      );
    }
  }

  dispose(): Promise<void> {
    if (this.disposing) return this.disposing;
    this.disposed = true;
    this.disposing = this.detach().finally(() => this.grid.dispose());
    return this.disposing;
  }

  private track<T>(task: Promise<T>, signal?: AbortSignal): Promise<T> {
    this.operations.add(task);
    void task.then(
      () => this.operations.delete(task),
      (error) => {
        this.operations.delete(task);
        if (!isRpcAbortedBy(error, signal?.reason)) this.retirementFailures.push(error);
      }
    );
    return task;
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
  if (entry.failure) return { kind: "error", message: entry.failure };
  return {
    kind: "exited",
    code: entry.exit?.code ?? null,
    ...(entry.exit?.signal ? { signal: entry.exit.signal } : {}),
  };
}

export function describeError(error: unknown): string {
  const seen = new Set<unknown>();
  const describe = (cause: unknown): string => {
    if (!(cause instanceof Error)) return String(cause);
    if (seen.has(cause)) return "[repeated error]";
    seen.add(cause);
    const children = cause instanceof AggregateError ? [...cause.errors] : [];
    if (cause.cause !== undefined) children.push(cause.cause);
    return [cause.message, ...children.map((child) => `Caused by: ${describe(child)}`)].join("\n");
  };
  return describe(error);
}

function cleanText(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text
    .replace(/[\x00-\x1f\x7f-\x9f]+/g, " ")
    .trim()
    .slice(0, MAX_TITLE_LENGTH);
}
