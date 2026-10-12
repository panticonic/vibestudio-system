import type { RpcClient } from "@vibestudio/rpc";
import { mainRpcMethods } from "@vibestudio/service-schemas/mainRpc";
import {
  TERMINAL_SESSIONS_CLASS,
  TERMINAL_SESSIONS_KEY,
  TERMINAL_SESSIONS_SOURCE,
  terminalSessionRegistryRpcMethods,
  type TerminalSessionRecord,
} from "@workspace-workers/terminal-sessions/contract";

/** A unit that declares `vibestudio.terminal`: something the launcher can start. */
export interface TerminalApp {
  source: string;
  className: string;
  title: string;
  description?: string;
  icon?: string;
}

/** Every terminal app in the workspace, alphabetically. */
export async function listTerminalApps(rpc: RpcClient): Promise<TerminalApp[]> {
  const sources = await rpc.call("main", mainRpcMethods["workers.listSources"], []);
  const apps: TerminalApp[] = [];
  for (const source of sources) {
    if (!source.terminal) continue;
    apps.push({
      source: source.source,
      className: source.terminal.className,
      title: source.terminal.title,
      ...(source.terminal.description ? { description: source.terminal.description } : {}),
      ...(source.terminal.icon ? { icon: source.terminal.icon } : {}),
    });
  }
  return apps.sort((a, b) => a.title.localeCompare(b.title));
}

/** A fresh context for a new session, so it gets its own workspace view (like a new panel). */
export async function createSessionContext(rpc: RpcClient): Promise<string> {
  const context = await rpc.call("main", mainRpcMethods["runtime.createContext"], [{}]);
  return context.contextId;
}

/**
 * The browser's view of the server-side session registry
 * (`workers/terminal-sessions`): which sessions this person can resume, and
 * their terminal settings.
 */
export class SessionRegistryClient {
  private target: Promise<string> | null = null;

  constructor(private readonly rpc: RpcClient) {}

  private resolve(): Promise<string> {
    this.target ??= this.rpc
      .call("main", mainRpcMethods["runtime.createEntity"], [
        {
          kind: "do",
          execution: { surface: "code", source: TERMINAL_SESSIONS_SOURCE },
          className: TERMINAL_SESSIONS_CLASS,
          key: TERMINAL_SESSIONS_KEY,
        },
      ])
      .then((entity) => entity.targetId)
      .catch((error: unknown) => {
        this.target = null;
        throw error;
      });
    return this.target;
  }

  async list(): Promise<TerminalSessionRecord[]> {
    return this.rpc.call(await this.resolve(), terminalSessionRegistryRpcMethods.listSessions, []);
  }

  async record(
    session: Pick<
      TerminalSessionRecord,
      "sessionId" | "source" | "className" | "title" | "contextId"
    >
  ): Promise<TerminalSessionRecord> {
    return this.rpc.call(await this.resolve(), terminalSessionRegistryRpcMethods.recordSession, [
      session,
    ]);
  }

  async markAttached(sessionId: string): Promise<void> {
    await this.rpc.call(await this.resolve(), terminalSessionRegistryRpcMethods.markAttached, [
      sessionId,
    ]);
  }

  async setTitle(sessionId: string, title: string): Promise<void> {
    await this.rpc.call(await this.resolve(), terminalSessionRegistryRpcMethods.setSessionTitle, [
      sessionId,
      title,
    ]);
  }

  async forget(sessionId: string): Promise<void> {
    await this.rpc.call(await this.resolve(), terminalSessionRegistryRpcMethods.forgetSession, [
      sessionId,
    ]);
  }

  async getSettings(): Promise<Record<string, unknown>> {
    return this.rpc.call(await this.resolve(), terminalSessionRegistryRpcMethods.getSettings, []);
  }

  async setSettings(settings: Record<string, unknown>): Promise<void> {
    await this.rpc.call(await this.resolve(), terminalSessionRegistryRpcMethods.setSettings, [
      settings,
    ]);
  }
}
