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
import { mainRpcMethods } from "@vibestudio/service-schemas/mainRpc";
import { EventsClient } from "@vibestudio/service-schemas/clients/eventsClient";
import type { TerminalSessionEntry } from "@vibestudio/shared/terminalSessions";
import type { JsonValue } from "@vibestudio/shared/wireValues";

export type { TerminalSessionEntry };

export interface LaunchRequest {
  /** `terminal-apps/<name>`; omitted for the person's login shell. */
  source?: string;
  cols: number;
  rows: number;
  /** How the browser opens approvals (e.g. "Ctrl-B a"), for the app to mention. */
  approvalsKey?: string;
}

export interface TerminalSessions {
  /** The person's sessions, newest activity first. */
  list(): Promise<TerminalSessionEntry[]>;
  launch(request: LaunchRequest): Promise<TerminalSessionEntry>;
  /** Attach-ready entry; relaunches the program when it is not running. */
  resume(request: {
    sessionId: string;
    cols: number;
    rows: number;
    approvalsKey?: string;
  }): Promise<TerminalSessionEntry>;
  /** End the session for good. */
  close(sessionId: string): Promise<void>;
  /** The session list changed (on any of the person's devices). Returns an unsubscribe. */
  onChange(listener: (sessions: TerminalSessionEntry[]) => void): () => void | Promise<void>;
}

export interface TerminalSettingsStore {
  getSettings(): Promise<Record<string, unknown>>;
  setSettings(settings: Record<string, JsonValue>): Promise<void>;
}

const SESSIONS_CHANGED_EVENT = "terminal-apps:sessions-changed";

export function createTerminalSessions(rpc: RpcClient): TerminalSessions {
  const events = new EventsClient(rpc);
  let listeners = 0;
  let admission: Promise<void> = Promise.resolve();
  return {
    list: () => rpc.call("main", mainRpcMethods["terminalApps.list"], []),
    launch: (request) => rpc.call("main", mainRpcMethods["terminalApps.launch"], [request]),
    resume: (request) => rpc.call("main", mainRpcMethods["terminalApps.resume"], [request]),
    close: (sessionId) => rpc.call("main", mainRpcMethods["terminalApps.close"], [sessionId]),
    onChange(listener) {
      const stop = events.on(SESSIONS_CHANGED_EVENT, (payload) => listener(payload.sessions));
      listeners += 1;
      if (listeners === 1) {
        admission = events
          .subscribe(SESSIONS_CHANGED_EVENT)
          .catch((error: unknown) =>
            console.warn("[terminal-browser] session updates are unavailable:", error)
          );
      }
      let disposed = false;
      return async () => {
        if (disposed) return;
        disposed = true;
        stop();
        listeners = Math.max(0, listeners - 1);
        if (listeners === 0) {
          await admission;
          await events.unsubscribe(SESSIONS_CHANGED_EVENT);
        }
      };
    },
  };
}
