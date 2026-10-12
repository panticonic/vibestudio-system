import { createReceiverRpcMethods } from "@vibestudio/shared/rpcMethods";

/** Where the terminal browser finds its session registry. */
export const TERMINAL_SESSIONS_SOURCE = "workers/terminal-sessions";
export const TERMINAL_SESSIONS_CLASS = "TerminalSessionsDO";
/** One registry per workspace; rows are partitioned by the calling person. */
export const TERMINAL_SESSIONS_KEY = "registry";

/** A resumable terminal session, as the registry remembers it. */
export interface TerminalSessionRecord {
  sessionId: string;
  /** Worker source of the terminal app, e.g. "workers/terminal-activity". */
  source: string;
  className: string;
  title: string;
  /** Context the session DO runs in; re-attaching must reuse it. */
  contextId: string;
  createdAt: number;
  lastAttachedAt: number;
}

export interface TerminalSessionRegistry {
  /** The caller's sessions, most recently attached first. */
  listSessions(): Promise<TerminalSessionRecord[]>;
  recordSession(
    session: Pick<
      TerminalSessionRecord,
      "sessionId" | "source" | "className" | "title" | "contextId"
    >
  ): Promise<TerminalSessionRecord>;
  markAttached(sessionId: string): Promise<void>;
  setSessionTitle(sessionId: string, title: string): Promise<void>;
  forgetSession(sessionId: string): Promise<void>;
  /** Opaque terminal-browser settings for the caller (validated by the browser). */
  getSettings(): Promise<Record<string, unknown>>;
  setSettings(settings: Record<string, unknown>): Promise<void>;
}

export const terminalSessionRegistryRpcMethods = createReceiverRpcMethods<TerminalSessionRegistry>([
  "listSessions",
  "recordSession",
  "markAttached",
  "setSessionTitle",
  "forgetSession",
  "getSettings",
  "setSettings",
]);
