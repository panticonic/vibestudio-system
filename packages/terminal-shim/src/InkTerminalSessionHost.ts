import type React from "react";
import { render, type Instance } from "ink";
import {
  TERMINAL_EVENT_CONTENT_TYPE,
  base64ToBytes,
  encodeSessionEvent,
  type TerminalAttachArgs,
  type TerminalAttention,
  type TerminalHostReply,
  type TerminalSessionEvent,
  type TerminalSize,
} from "@workspace/terminal-host-protocol";
import { SessionStdin } from "./streams/SessionStdin.js";
import { SessionStdout } from "./streams/SessionStdout.js";

/** A file the user chose in the browser and sent to the session. */
export interface TerminalFile {
  name: string;
  mimeType?: string;
  bytes: Uint8Array;
}

/**
 * What a terminal app sees of its attachment. One handle exists per
 * attachment; it stops working (requests settle as declined) when the
 * browser detaches.
 */
export interface TerminalSessionHandle {
  readonly sessionId: string;
  size(): TerminalSize;
  isFocused(): boolean;
  onFocusChange(listener: (focused: boolean) => void): () => void;
  /** Title shown in the browser's tab strip and session list. */
  setTitle(title: string): void;
  /** Ask for the user's attention while the tab is unfocused; `null` clears it. */
  setAttention(attention: TerminalAttention | null): void;
  /** Ask the browser to open a URL on the user's machine. Resolves false if declined or detached. */
  openUrl(url: string): Promise<boolean>;
  /** Ask the user to pick a local file. Resolves null if declined or detached. */
  requestFile(prompt?: string): Promise<TerminalFile | null>;
  /** End the session: the browser closes its tab and the session is not resumable. */
  end(reason?: string): void;
}

export interface InkTerminalSessionHostOptions {
  /**
   * Render the app for a new attachment. Called on every attach — the first
   * one and every resume — so the tree must rebuild its view from durable
   * state (DO storage, the channel, ...), never from memory of a previous
   * attachment: a detached DO may have been evicted.
   */
  render(session: TerminalSessionHandle): React.ReactElement;
  /** The user closed the session for good; discard its durable state. */
  onClose?(sessionId: string): Promise<void> | void;
}

type PendingRequest =
  | { kind: "open-url"; resolve: (opened: boolean) => void }
  | { kind: "request-file"; resolve: (file: TerminalFile | null) => void };

class Attachment {
  readonly stdout: SessionStdout;
  readonly stdin = new SessionStdin();
  instance: Instance | null = null;
  focused: boolean;
  closed = false;
  private outputBuffer = "";
  private flushQueued = false;
  readonly focusListeners = new Set<(focused: boolean) => void>();
  readonly pending = new Map<string, PendingRequest>();

  constructor(
    readonly callerId: string,
    readonly sessionId: string,
    private readonly controller: ReadableStreamDefaultController<Uint8Array>,
    args: TerminalAttachArgs
  ) {
    this.focused = args.focused;
    this.stdout = new SessionStdout((text) => this.output(text), args.viewport);
  }

  /** Coalesce Ink's many small writes of one render into one output event. */
  private output(text: string): void {
    if (this.closed) return;
    this.outputBuffer += text;
    if (this.flushQueued) return;
    this.flushQueued = true;
    queueMicrotask(() => {
      this.flushQueued = false;
      const data = this.outputBuffer;
      this.outputBuffer = "";
      if (data) this.send({ type: "output", data });
    });
  }

  send(event: TerminalSessionEvent): void {
    if (this.closed) return;
    this.controller.enqueue(encodeSessionEvent(event));
  }

  /** Tear down the render tree and settle every outstanding request. */
  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    this.instance?.unmount();
    this.instance = null;
    this.stdin.destroy();
    for (const request of this.pending.values()) {
      if (request.kind === "open-url") request.resolve(false);
      else request.resolve(null);
    }
    this.pending.clear();
    this.focusListeners.clear();
  }

  /** End the stream from the session side. */
  finish(final?: TerminalSessionEvent): void {
    if (this.closed) return;
    if (this.outputBuffer) {
      this.send({ type: "output", data: this.outputBuffer });
      this.outputBuffer = "";
    }
    if (final) this.send(final);
    this.dispose();
    try {
      this.controller.close();
    } catch {
      // The browser already cancelled the stream.
    }
  }
}

/**
 * Implements the terminal session protocol for one Durable Object: owns the
 * attachment stream, renders the app with Ink into it, routes browser input,
 * and enforces that only the attached browser may drive the session.
 *
 * A DO forwards its `@rpc` methods here, passing the authenticated caller id
 * (`this.caller?.callerId`). The stream returned by `attach` is what keeps the
 * DO resident; once the browser cancels it, the render tree is released.
 */
export class InkTerminalSessionHost {
  private attachment: Attachment | null = null;
  private requestCounter = 0;
  private title: string | null = null;
  private attention: TerminalAttention | null = null;

  constructor(private readonly options: InkTerminalSessionHostOptions) {}

  attach(callerId: string | null | undefined, args: TerminalAttachArgs): Response {
    if (!callerId) throw new Error("terminalAttach requires an authenticated caller");
    assertSessionArgs(args);
    // A new attachment supersedes the previous one, from any browser.
    this.attachment?.finish({ type: "superseded" });
    this.attachment = null;

    let attachment!: Attachment;
    const body = new ReadableStream<Uint8Array>({
      start: (controller) => {
        attachment = new Attachment(callerId, args.sessionId, controller, args);
      },
      cancel: () => {
        // Detach: the browser closed the stream (detach, quit, lost transport).
        attachment.dispose();
        if (this.attachment === attachment) this.attachment = null;
      },
    });
    this.attachment = attachment;
    if (this.title) attachment.send({ type: "title", title: this.title });
    if (this.attention) attachment.send({ type: "attention", attention: this.attention });
    // Every attachment starts from a cleared screen, then the full render.
    attachment.send({ type: "output", data: "\x1b[0m\x1b[2J\x1b[3J\x1b[H" });
    const handle = this.handleFor(attachment);
    attachment.instance = render(this.options.render(handle), {
      stdout: attachment.stdout as unknown as NodeJS.WriteStream,
      stderr: attachment.stdout as unknown as NodeJS.WriteStream,
      stdin: attachment.stdin as unknown as NodeJS.ReadStream,
      exitOnCtrlC: false,
      patchConsole: false,
      maxFps: 60,
    });
    const instance = attachment.instance;
    void instance.waitUntilExit().then(
      () => {
        // The app exited on its own (Ink `useApp().exit()`): the session is over.
        if (!attachment.closed) attachment.finish({ type: "ended" });
      },
      (error: unknown) => {
        if (!attachment.closed) {
          attachment.finish({ type: "ended", reason: errorMessage(error) });
        }
      }
    );
    return new Response(body, {
      headers: { "Content-Type": TERMINAL_EVENT_CONTENT_TYPE, "Cache-Control": "no-store" },
    });
  }

  input(callerId: string | null | undefined, sessionId: string, data: string): void {
    if (typeof data !== "string") throw new Error("terminalInput data must be a string");
    this.owned(callerId, sessionId).stdin.deliver(data);
  }

  resize(callerId: string | null | undefined, sessionId: string, size: TerminalSize): void {
    assertSize(size);
    this.owned(callerId, sessionId).stdout.resize(size);
  }

  focus(callerId: string | null | undefined, sessionId: string, focused: boolean): void {
    const attachment = this.owned(callerId, sessionId);
    attachment.focused = Boolean(focused);
    for (const listener of [...attachment.focusListeners]) listener(attachment.focused);
  }

  reply(callerId: string | null | undefined, sessionId: string, reply: TerminalHostReply): void {
    const attachment = this.owned(callerId, sessionId);
    const pending = attachment.pending.get(reply?.requestId);
    if (!pending || pending.kind !== reply.kind) {
      throw new Error("terminalReply does not answer an open request of this session");
    }
    attachment.pending.delete(reply.requestId);
    if (pending.kind === "open-url" && reply.kind === "open-url") {
      pending.resolve(reply.opened === true);
    } else if (pending.kind === "request-file" && reply.kind === "request-file") {
      pending.resolve(
        reply.file
          ? {
              name: reply.file.name,
              ...(reply.file.mimeType ? { mimeType: reply.file.mimeType } : {}),
              bytes: base64ToBytes(reply.file.data),
            }
          : null
      );
    }
  }

  async close(callerId: string | null | undefined, sessionId: string): Promise<void> {
    const attachment = this.attachment;
    // Closing is allowed for the attached browser, or for any browser when the
    // session is detached (resuming it just to close it would be pointless).
    if (attachment && attachment.callerId !== callerId) {
      throw new Error("This terminal session is attached to another terminal");
    }
    if (attachment && attachment.sessionId !== sessionId) {
      throw new Error("Session id does not match this terminal session");
    }
    attachment?.finish({ type: "ended", reason: "closed" });
    this.attachment = null;
    this.title = null;
    this.attention = null;
    await this.options.onClose?.(sessionId);
  }

  private owned(callerId: string | null | undefined, sessionId: string): Attachment {
    const attachment = this.attachment;
    if (!attachment || attachment.closed) {
      throw new Error("This terminal session has no attached terminal");
    }
    if (!callerId || attachment.callerId !== callerId) {
      throw new Error("This terminal session is attached to another terminal");
    }
    if (attachment.sessionId !== sessionId) {
      throw new Error("Session id does not match this terminal session");
    }
    return attachment;
  }

  private handleFor(attachment: Attachment): TerminalSessionHandle {
    const request = <T>(
      kind: PendingRequest["kind"],
      event: (id: string) => TerminalSessionEvent,
      declined: T
    ) =>
      new Promise<T>((resolve) => {
        if (attachment.closed) {
          resolve(declined);
          return;
        }
        const requestId = `req-${++this.requestCounter}`;
        attachment.pending.set(requestId, { kind, resolve } as PendingRequest);
        attachment.send(event(requestId));
      });
    return {
      sessionId: attachment.sessionId,
      size: () => ({ columns: attachment.stdout.columns, rows: attachment.stdout.rows }),
      isFocused: () => attachment.focused,
      onFocusChange: (listener) => {
        attachment.focusListeners.add(listener);
        return () => attachment.focusListeners.delete(listener);
      },
      setTitle: (title) => {
        const clean = sanitizeLine(title, 80);
        this.title = clean;
        attachment.send({ type: "title", title: clean });
      },
      setAttention: (attention) => {
        const clean = attention
          ? {
              ...(attention.reason ? { reason: sanitizeLine(attention.reason, 60) } : {}),
              ...(attention.bell ? { bell: true } : {}),
            }
          : null;
        this.attention = clean;
        attachment.send({ type: "attention", attention: clean });
      },
      openUrl: (url) =>
        request<boolean>("open-url", (requestId) => ({ type: "open-url", requestId, url }), false),
      requestFile: (prompt) =>
        request<TerminalFile | null>(
          "request-file",
          (requestId) => ({
            type: "request-file",
            requestId,
            ...(prompt ? { prompt: sanitizeLine(prompt, 200) } : {}),
          }),
          null
        ),
      end: (reason) => {
        attachment.finish({
          type: "ended",
          ...(reason ? { reason: sanitizeLine(reason, 200) } : {}),
        });
        if (this.attachment === attachment) this.attachment = null;
      },
    };
  }
}

function sanitizeLine(text: string, max: number): string {
  // eslint-disable-next-line no-control-regex
  return String(text)
    .replace(/[\x00-\x1f\x7f-\x9f]/g, " ")
    .trim()
    .slice(0, max);
}

function assertSize(size: TerminalSize): void {
  if (
    !size ||
    !Number.isInteger(size.columns) ||
    !Number.isInteger(size.rows) ||
    size.columns < 1 ||
    size.rows < 1 ||
    size.columns > 1000 ||
    size.rows > 1000
  ) {
    throw new Error("Terminal size must be integer columns/rows between 1 and 1000");
  }
}

function assertSessionArgs(args: TerminalAttachArgs): void {
  if (!args || typeof args.sessionId !== "string" || args.sessionId.length === 0) {
    throw new Error("terminalAttach requires a session id");
  }
  assertSize(args.viewport);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
