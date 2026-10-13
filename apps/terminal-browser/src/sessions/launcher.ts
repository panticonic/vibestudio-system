/**
 * The terminal launch service (`terminalApps.*` on the main RPC target): the
 * one per-person registry of terminal sessions in a workspace. It starts
 * terminal apps and login shells in PTYs of the workspace's shell extension,
 * relaunches them, ends them, and keeps the terminal browser's settings.
 *
 * This module is the only place in the browser that knows the service's
 * method and event names. The browser reaches the shown workspace's instance
 * through `host.workspaceRpc` (sessions) and the System workspace's instance
 * through `host.rpc` (settings).
 */
import type { RpcClient } from "@vibestudio/rpc";
import { mainRpcMethod } from "@vibestudio/service-schemas/mainRpc";
import { EventsClient } from "@vibestudio/service-schemas/clients/eventsClient";
import type { EventName } from "@vibestudio/shared/events";

export interface TerminalSessionEntry {
  /** The person's session (registry id); stable across relaunches. */
  sessionId: string;
  kind: "app" | "shell";
  /** `terminal-apps/<name>` for an app. */
  source?: string;
  title: string;
  icon?: string;
  /** The app's runtime principal: approvals it raises carry it as `callerId`. */
  principalId?: string;
  /** The PTY to attach to through the shell extension, while there is one. */
  shellSessionId: string | null;
  running: boolean;
  exit?: { code: number | null; signal?: string };
  createdAt: number;
  lastActiveAt: number;
}

export interface LaunchRequest {
  /** `terminal-apps/<name>`; omitted for the person's login shell. */
  source?: string;
  cols: number;
  rows: number;
  /** How the browser opens approvals (e.g. "Ctrl-Space a"), for the app to mention. */
  approvalsKey?: string;
}

export interface TerminalSessions {
  /** The person's sessions, newest activity first. */
  list(): Promise<TerminalSessionEntry[]>;
  launch(request: LaunchRequest): Promise<TerminalSessionEntry>;
  /** Attach-ready entry; relaunches the program when it is not running. */
  resume(request: { sessionId: string; cols: number; rows: number }): Promise<TerminalSessionEntry>;
  /** End the session for good. */
  close(sessionId: string): Promise<void>;
  /** The session list changed (on any of the person's devices). Returns an unsubscribe. */
  onChange(listener: (sessions: TerminalSessionEntry[]) => void): () => void;
}

export interface TerminalSettingsStore {
  getSettings(): Promise<Record<string, unknown>>;
  setSettings(settings: Record<string, unknown>): Promise<void>;
}

/**
 * The service is not offered by this server at all (as opposed to a call that
 * failed). The message says what to do about it.
 */
export class TerminalServiceUnavailableError extends Error {
  override readonly name = "TerminalServiceUnavailableError";
}

const SERVICE = "terminalApps";
/**
 * Declared by the host together with the service; until the host's event
 * table names it, it is addressed here by its wire name.
 */
const SESSIONS_CHANGED_EVENT = "terminal-apps:sessions-changed" as EventName;

export function createTerminalSessions(rpc: RpcClient): TerminalSessions & TerminalSettingsStore {
  const call = async (method: string, args: unknown[]): Promise<unknown> => {
    let descriptor;
    try {
      descriptor = mainRpcMethod(`${SERVICE}.${method}`);
    } catch (error) {
      throw new TerminalServiceUnavailableError(
        `this Vibestudio server has no terminal launch service (${
          error instanceof Error ? error.message : String(error)
        }). Update Vibestudio, then try again.`
      );
    }
    return rpc.call("main", descriptor, args);
  };
  const events = new EventsClient(rpc);
  let listeners = 0;
  return {
    async list() {
      const result = await call("list", []);
      if (!Array.isArray(result)) throw new Error("the terminal launch service returned no list");
      return result.map(parseEntry);
    },
    async launch(request) {
      return parseEntry(await call("launch", [request]));
    },
    async resume(request) {
      return parseEntry(await call("resume", [request]));
    },
    async close(sessionId) {
      await call("close", [sessionId]);
    },
    async getSettings() {
      const result = await call("getSettings", []);
      return result && typeof result === "object" && !Array.isArray(result)
        ? (result as Record<string, unknown>)
        : {};
    },
    async setSettings(settings) {
      await call("setSettings", [settings]);
    },
    onChange(listener) {
      const stop = events.on(SESSIONS_CHANGED_EVENT, (payload: unknown) => {
        const sessions = (payload as { sessions?: unknown } | null)?.sessions;
        if (Array.isArray(sessions)) listener(sessions.map(parseEntry));
      });
      listeners += 1;
      if (listeners === 1) {
        void events
          .subscribe(SESSIONS_CHANGED_EVENT)
          .catch((error: unknown) =>
            console.warn("[terminal-browser] session updates are unavailable:", error)
          );
      }
      let disposed = false;
      return () => {
        if (disposed) return;
        disposed = true;
        stop();
        listeners = Math.max(0, listeners - 1);
        if (listeners === 0) void events.unsubscribe(SESSIONS_CHANGED_EVENT).catch(() => {});
      };
    },
  };
}

function parseEntry(value: unknown): TerminalSessionEntry {
  const entry = value as Partial<TerminalSessionEntry> | null;
  if (
    !entry ||
    typeof entry.sessionId !== "string" ||
    (entry.kind !== "app" && entry.kind !== "shell") ||
    typeof entry.title !== "string" ||
    (entry.shellSessionId !== null && typeof entry.shellSessionId !== "string")
  ) {
    throw new Error("the terminal launch service returned a malformed session");
  }
  return entry as TerminalSessionEntry;
}
