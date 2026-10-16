import type { RnClientApi, RemoteAccount, RemoteConnection } from "@vibestudio/rn-client-api";
import { createTypedRpcServiceClient } from "@vibestudio/shared/typedRpcServiceClient";
import { hubControlMethods } from "@vibestudio/service-schemas/hubControl";
import { mainRpcMethods } from "@vibestudio/service-schemas/mainRpc";
import type { ConnectionConfig } from "@workspace/agentic-core";

/** The client-state key holding the workspace context new conversations start in. */
export const HOME_CONTEXT_KEY = "chat.homeContext";

/**
 * The chat's live connection: this device's session in the Personal
 * workspace, the context conversations start in, and the participant identity
 * the chat joins channels as. The conversation, its agents and approvals all
 * live in that workspace, so they use the device's routed session there; the
 * client's own principal session (System) is not needed to talk.
 */
export interface ChatConnection {
  readonly workspaceId: string;
  readonly workspace: RemoteConnection;
  readonly contextId: string;
  readonly connection: ConnectionConfig;
  close(): Promise<void>;
}

/**
 * Open the chat connection through the host: find the account's Personal
 * workspace over hub control, open this device's session there, and resolve
 * the home context (created once, remembered in the client's state, so the
 * person's conversations are in the same context on every launch).
 *
 * Any failure closes what was opened and reaches the caller unchanged.
 */
export async function openChatConnection(api: RnClientApi): Promise<ChatConnection> {
  const account = await api.session.openAccount();
  try {
    const hubControl = createTypedRpcServiceClient(
      account.control.rpc,
      { targetId: "main", namespace: "hubControl" },
      hubControlMethods
    );
    const { personal } = await hubControl.ensureUserWorkspaces();
    const workspace = await account.openWorkspace(personal.workspaceId);
    const contextId = await homeContext(workspace, api);
    return {
      workspaceId: personal.workspaceId,
      workspace,
      contextId,
      connection: {
        clientId: `${api.client.clientId}:${api.client.deviceId}`,
        rpc: workspace.rpc,
      },
      close: () => closeAccount(account),
    };
  } catch (error) {
    await closeAccount(account).catch(() => undefined);
    throw error;
  }
}

function closeAccount(account: RemoteAccount): Promise<void> {
  return account.close();
}

async function homeContext(workspace: RemoteConnection, api: RnClientApi): Promise<string> {
  const remembered = await api.state.get(HOME_CONTEXT_KEY);
  if (remembered) return remembered;
  const { contextId } = await workspace.rpc.call("main", mainRpcMethods["runtime.createContext"], [{}]);
  await api.state.set(HOME_CONTEXT_KEY, contextId);
  return contextId;
}
