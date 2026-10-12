import { createReceiverRpcMethods } from "@vibestudio/shared/rpcMethods";

/** Service protocol the terminal browser resolves its session registry by (one per workspace). */
export const TERMINAL_SESSIONS_PROTOCOL = "vibestudio.terminal-sessions.v1";

/** A resumable terminal session, as the registry remembers it. */
export interface TerminalSessionRecord {
  sessionId: string;
  /** Workspace the session DO runs in (the workspace the browser showed when it started). */
  workspaceId: string;
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
  /** The caller's sessions in one workspace, most recently attached first. */
  listSessions(workspaceId: string): Promise<TerminalSessionRecord[]>;
  recordSession(
    session: Pick<
      TerminalSessionRecord,
      "sessionId" | "workspaceId" | "source" | "className" | "title" | "contextId"
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
