import type { RpcClient } from "@vibestudio/rpc";
import { mainRpcMethods } from "@vibestudio/service-schemas/mainRpc";
import {
  TerminalEventDecoder,
  terminalSessionRpcMethods,
  type TerminalAttention,
  type TerminalHostReply,
  type TerminalSessionEvent,
  type TerminalSize,
} from "@workspace/terminal-host-protocol";
import type { TerminalSessionRecord } from "@workspace-workers/terminal-sessions/contract";
import { VtGrid } from "../compositor/vtGrid.js";

export type SessionStatus =
  | { kind: "attaching" }
  | { kind: "live" }
  /** The attachment ended without the session saying why (transport or server). */
  | { kind: "disconnected"; reason: string }
  /** Another terminal attached to this session. */
  | { kind: "superseded" }
  | { kind: "error"; message: string };

export type HostRequest =
  | { kind: "open-url"; requestId: string; url: string }
  | { kind: "request-file"; requestId: string; prompt?: string };

export interface SessionEvents {
  /** Status or attention changed. */
  changed(): void;
  /** The app set a new title. */
  titled(session: TerminalSessionClient): void;
  /** The grid shows new output. */
  output(): void;
  hostRequest(session: TerminalSessionClient, request: HostRequest): void;
  /** The session ended itself; the tab should close. */
  ended(session: TerminalSessionClient, reason: string | undefined): void;
  /** The session rang the bell or asked for attention with a bell. */
  bell(session: TerminalSessionClient): void;
  log(level: "info" | "warn" | "error", message: string): void;
}

/**
 * The browser side of one terminal session: activates the session DO,
 * holds the attachment stream that keeps it resident, feeds its output into
 * the session's grid, and sends input in order.
 */
export class TerminalSessionClient {
  readonly grid: VtGrid;
  title: string;
  status: SessionStatus = { kind: "attaching" };
  attention: TerminalAttention | null = null;
  targetId: string | null = null;

  private attachment: AbortController | null = null;
  private inputInFlight: Promise<void> | null = null;
  private queuedInput = "";
  private latestSize: TerminalSize;
  private resizeInFlight = false;
  private resizeQueued = false;
  private focused = false;

  constructor(
    private readonly rpc: RpcClient,
    readonly record: TerminalSessionRecord,
    viewport: TerminalSize,
    private readonly events: SessionEvents
  ) {
    this.title = record.title;
    this.latestSize = { ...viewport };
    this.grid = new VtGrid(viewport);
    this.grid.onBell(() => this.events.bell(this));
  }

  get sessionId(): string {
    return this.record.sessionId;
  }

  isLive(): boolean {
    return this.status.kind === "live";
  }

  /** Attach (or re-attach): every attachment starts from a clean grid and a full repaint. */
  async attach(focused: boolean): Promise<void> {
    this.detach();
    const controller = new AbortController();
    this.attachment = controller;
    this.focused = focused;
    this.setStatus({ kind: "attaching" });
    this.grid.reset();
    this.events.output();
    try {
      const targetId = await this.activate();
      if (controller.signal.aborted) return;
      const response = await this.rpc.stream(
        targetId,
        terminalSessionRpcMethods.terminalAttach,
        [{ sessionId: this.sessionId, viewport: this.latestSize, focused }],
        { signal: controller.signal }
      );
      if (controller.signal.aborted) return;
      if (!response.ok || !response.body) {
        throw new Error(`the app refused the attachment (HTTP ${response.status})`);
      }
      this.setStatus({ kind: "live" });
      await this.read(response.body, controller);
    } catch (error) {
      if (controller.signal.aborted) return;
      this.setStatus({ kind: "error", message: describeError(error) });
      this.events.log("error", `${this.title}: ${describeError(error)}`);
    } finally {
      if (this.attachment === controller) this.attachment = null;
    }
  }

  /** Activate the session DO in its own context (idempotent for an existing session). */
  private async activate(): Promise<string> {
    const entity = await this.rpc.call("main", mainRpcMethods["runtime.createEntity"], [
      {
        kind: "do",
        execution: { surface: "code", source: this.record.source },
        className: this.record.className,
        key: this.record.sessionId,
        contextId: this.record.contextId,
      },
    ]);
    this.targetId = entity.targetId;
    return entity.targetId;
  }

  private async read(body: ReadableStream<Uint8Array>, controller: AbortController): Promise<void> {
    const reader = body.getReader();
    const decoder = new TerminalEventDecoder();
    let final: "ended" | "superseded" | null = null;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        for (const event of decoder.push(value)) {
          const outcome = this.handle(event);
          if (outcome) final = outcome;
        }
      }
      decoder.end();
    } catch (error) {
      if (controller.signal.aborted) return;
      void reader.cancel().catch(() => {});
      throw error;
    }
    if (controller.signal.aborted) return;
    if (final === "superseded") this.setStatus({ kind: "superseded" });
    else if (final !== "ended") {
      this.setStatus({ kind: "disconnected", reason: "the connection to the app ended" });
    }
  }

  private handle(event: TerminalSessionEvent): "ended" | "superseded" | null {
    switch (event.type) {
      case "output":
        void this.grid.write(event.data).then(() => this.events.output());
        return null;
      case "title":
        this.title = event.title || this.record.title;
        this.events.titled(this);
        return null;
      case "attention":
        this.attention = event.attention;
        if (event.attention?.bell && !this.focused) this.events.bell(this);
        this.events.changed();
        return null;
      case "open-url":
        this.events.hostRequest(this, {
          kind: "open-url",
          requestId: event.requestId,
          url: event.url,
        });
        return null;
      case "request-file":
        this.events.hostRequest(this, {
          kind: "request-file",
          requestId: event.requestId,
          ...(event.prompt ? { prompt: event.prompt } : {}),
        });
        return null;
      case "ended":
        this.events.ended(this, event.reason);
        return "ended";
      case "superseded":
        return "superseded";
    }
  }

  /** Stop receiving output; the session keeps its state and may be evicted. */
  detach(): void {
    const attachment = this.attachment;
    this.attachment = null;
    attachment?.abort();
    this.queuedInput = "";
  }

  /** Send input in order; input typed while a send is in flight goes out as one batch after it. */
  sendInput(data: string): void {
    if (!this.isLive() || !this.targetId || data.length === 0) return;
    this.queuedInput += data;
    if (this.inputInFlight) return;
    this.inputInFlight = this.flushInput().finally(() => {
      this.inputInFlight = null;
    });
  }

  private async flushInput(): Promise<void> {
    while (this.queuedInput && this.targetId && this.isLive()) {
      const data = this.queuedInput;
      this.queuedInput = "";
      try {
        await this.rpc.call(this.targetId, terminalSessionRpcMethods.terminalInput, [
          this.sessionId,
          data,
        ]);
      } catch (error) {
        this.queuedInput = "";
        if (!this.attachment) return; // detached meanwhile
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
    if (!this.isLive() || !this.targetId) return;
    if (this.resizeInFlight) {
      this.resizeQueued = true;
      return;
    }
    this.resizeInFlight = true;
    void (async () => {
      try {
        do {
          this.resizeQueued = false;
          await this.rpc.call(this.targetId!, terminalSessionRpcMethods.terminalResize, [
            this.sessionId,
            this.latestSize,
          ]);
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
    if (!this.isLive() || !this.targetId) return;
    void this.rpc
      .call(this.targetId, terminalSessionRpcMethods.terminalFocus, [this.sessionId, focused])
      .catch((error: unknown) =>
        this.events.log("warn", `${this.title}: focus update failed: ${describeError(error)}`)
      );
  }

  async reply(reply: TerminalHostReply): Promise<void> {
    if (!this.targetId || !this.isLive()) return;
    await this.rpc.call(this.targetId, terminalSessionRpcMethods.terminalReply, [
      this.sessionId,
      reply,
    ]);
  }

  /** End the session for good. */
  async close(): Promise<void> {
    this.detach();
    const targetId = this.targetId ?? (await this.activate());
    await this.rpc.call(targetId, terminalSessionRpcMethods.terminalClose, [this.sessionId]);
  }

  dispose(): void {
    this.detach();
    this.grid.dispose();
  }

  private setStatus(status: SessionStatus): void {
    this.status = status;
    this.events.changed();
  }
}

export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
