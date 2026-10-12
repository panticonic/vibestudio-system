import type { RpcClient } from "@vibestudio/rpc";
import { mainRpcMethods } from "@vibestudio/service-schemas/mainRpc";
import { createDurableObjectServiceClient } from "@vibestudio/service-schemas/clients/durableObjectServiceClient";
import type { DurableObjectServiceClient } from "@vibestudio/shared/workspaceServiceRpc";
import {
  TERMINAL_SESSIONS_PROTOCOL,
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

/** Every terminal app in the workspace `rpc` reaches, alphabetically. */
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
 * (`workers/terminal-sessions` in the System workspace, reached as the
 * browser's app principal): which sessions this person can resume in each
 * workspace, and their terminal settings.
 */
export class SessionRegistryClient {
  private readonly service: DurableObjectServiceClient<typeof terminalSessionRegistryRpcMethods>;

  constructor(rpc: RpcClient) {
    this.service = createDurableObjectServiceClient(
      rpc,
      TERMINAL_SESSIONS_PROTOCOL,
      terminalSessionRegistryRpcMethods
    );
  }

  /** This person's sessions in one workspace, most recently used first. */
  async list(workspaceId: string): Promise<TerminalSessionRecord[]> {
    return (await this.service.call("listSessions", workspaceId)) as TerminalSessionRecord[];
  }

  async record(
    session: Pick<
      TerminalSessionRecord,
      "sessionId" | "workspaceId" | "source" | "className" | "title" | "contextId"
    >
  ): Promise<TerminalSessionRecord> {
    return (await this.service.call("recordSession", session)) as TerminalSessionRecord;
  }

  async markAttached(sessionId: string): Promise<void> {
    await this.service.call("markAttached", sessionId);
  }

  async setTitle(sessionId: string, title: string): Promise<void> {
    await this.service.call("setSessionTitle", sessionId, title);
  }

  async forget(sessionId: string): Promise<void> {
    await this.service.call("forgetSession", sessionId);
  }

  async getSettings(): Promise<Record<string, unknown>> {
    return (await this.service.call("getSettings")) as Record<string, unknown>;
  }

  async setSettings(settings: Record<string, unknown>): Promise<void> {
    await this.service.call("setSettings", settings);
  }
}
