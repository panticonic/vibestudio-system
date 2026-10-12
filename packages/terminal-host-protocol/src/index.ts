import { createReceiverRpcMethods } from "@vibestudio/shared/rpcMethods";

/**
 * @workspace/terminal-host-protocol
 *
 * The protocol between the trusted terminal browser and a sandboxed terminal
 * session worker (a Durable Object that renders Ink inside workerd).
 *
 * Two directions, one channel each:
 *
 * - **browser → session**: ordinary RPC calls on the session DO
 *   (`terminalSessionRpcMethods`). The DO accepts them only from the caller
 *   that holds the current attachment.
 * - **session → browser**: the body of the `terminalAttach` streaming
 *   response, an ordered NDJSON sequence of `TerminalSessionEvent`s. The
 *   stream is the attachment: while it is open the DO is resident and the
 *   browser is the only party that receives the session's output; when the
 *   browser cancels it (detach, quit, transport loss) the DO releases its
 *   render tree and may be evicted. Every attachment begins with a complete
 *   repaint, so there is no frame sequence that can develop gaps.
 *
 * Because the browser exposes no RPC methods at all, nothing else in the
 * workspace can push bytes into, or ask questions through, the browser's
 * chrome. Requests that need the user's answer (`open-url`, `request-file`)
 * travel down the stream and are answered with `terminalReply`.
 */

export interface TerminalSize {
  columns: number;
  rows: number;
}

/** Arguments of `terminalAttach`. Re-attaching to the same session id resumes it. */
export interface TerminalAttachArgs {
  /** Stable session id; also the session DO's object key. */
  sessionId: string;
  /** Initial viewport; the browser is authoritative and follows up with `terminalResize`. */
  viewport: TerminalSize;
  /** Whether the session's tab is focused right now. */
  focused: boolean;
}

/** A user reply to a host request the session made through its attachment. */
export type TerminalHostReply =
  | { requestId: string; kind: "open-url"; opened: boolean }
  | {
      requestId: string;
      kind: "request-file";
      /** Absent when the user declined. */
      file?: { name: string; mimeType?: string; data: string /* base64 */ };
    };

/** Attention a session asks for while its tab is not focused. */
export interface TerminalAttention {
  /** Short reason shown in the tab strip, e.g. "agent finished". */
  reason?: string;
  /** Ring the terminal bell too (subject to the user's bell setting). */
  bell?: boolean;
}

/** Events a session sends to the browser over its attachment stream. */
export type TerminalSessionEvent =
  /** Terminal output (text containing ANSI/VT sequences). */
  | { type: "output"; data: string }
  | { type: "title"; title: string }
  /** `attention: null` clears a previous request. */
  | { type: "attention"; attention: TerminalAttention | null }
  /** Ask the browser to open a URL on the user's machine, after confirmation. */
  | { type: "open-url"; requestId: string; url: string }
  /** Ask the user to choose a local file to send to the session. */
  | { type: "request-file"; requestId: string; prompt?: string }
  /** The session ended itself (e.g. the user typed /quit); the browser closes the tab. */
  | { type: "ended"; reason?: string }
  /** Another browser attached to this session; this attachment is over. */
  | { type: "superseded" };

/** The surface a terminal session DO exposes to the browser. */
export interface TerminalSession {
  /** Attach (or re-attach) and stream `TerminalSessionEvent`s as NDJSON until detached. */
  terminalAttach(args: TerminalAttachArgs): Promise<Response>;
  /** Keyboard / paste / mouse bytes for the session, already routed by the browser. */
  terminalInput(sessionId: string, data: string): Promise<void>;
  terminalResize(sessionId: string, size: TerminalSize): Promise<void>;
  terminalFocus(sessionId: string, focused: boolean): Promise<void>;
  terminalReply(sessionId: string, reply: TerminalHostReply): Promise<void>;
  /** End the session for good: the DO discards its state. Detaching is cancelling the stream. */
  terminalClose(sessionId: string): Promise<void>;
}

/** The single method table for the session surface. */
export const terminalSessionRpcMethods = createReceiverRpcMethods<TerminalSession>([
  "terminalAttach",
  "terminalInput",
  "terminalResize",
  "terminalFocus",
  "terminalReply",
  "terminalClose",
]);

export const TERMINAL_EVENT_CONTENT_TYPE = "application/x-ndjson";

// ── NDJSON codec ────────────────────────────────────────────────────────────

const encoder = new TextEncoder();

export function encodeSessionEvent(event: TerminalSessionEvent): Uint8Array {
  return encoder.encode(`${JSON.stringify(event)}\n`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isSessionEvent(value: unknown): value is TerminalSessionEvent {
  if (!isRecord(value)) return false;
  switch (value["type"]) {
    case "output":
      return typeof value["data"] === "string";
    case "title":
      return typeof value["title"] === "string";
    case "attention":
      return value["attention"] === null || isRecord(value["attention"]);
    case "open-url":
      return typeof value["requestId"] === "string" && typeof value["url"] === "string";
    case "request-file":
      return typeof value["requestId"] === "string";
    case "ended":
    case "superseded":
      return true;
    default:
      return false;
  }
}

/**
 * Incremental NDJSON decoder for the attachment stream. A malformed line is a
 * protocol violation by the session and throws; it is never silently skipped.
 */
export class TerminalEventDecoder {
  private readonly decoder = new TextDecoder();
  private pending = "";

  push(chunk: Uint8Array): TerminalSessionEvent[] {
    this.pending += this.decoder.decode(chunk, { stream: true });
    const events: TerminalSessionEvent[] = [];
    let newline = this.pending.indexOf("\n");
    while (newline !== -1) {
      const line = this.pending.slice(0, newline);
      this.pending = this.pending.slice(newline + 1);
      if (line.trim().length > 0) events.push(parseLine(line));
      newline = this.pending.indexOf("\n");
    }
    return events;
  }

  /** Call when the stream ends; a trailing partial line is a protocol error. */
  end(): void {
    this.pending += this.decoder.decode();
    if (this.pending.trim().length > 0) {
      throw new Error("terminal session stream ended in the middle of an event");
    }
  }
}

function parseLine(line: string): TerminalSessionEvent {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    throw new Error("terminal session sent a malformed event (not JSON)");
  }
  if (!isSessionEvent(value)) {
    throw new Error("terminal session sent an unknown or malformed event");
  }
  return value;
}

// ── base64 for binary payloads (file replies) ──────────────────────────────

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
