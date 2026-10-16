import type { RpcClient } from "@vibestudio/rpc";
import { hubControlMethods } from "@vibestudio/service-schemas/hubControl";
import { EventsClient } from "@vibestudio/service-schemas/clients/eventsClient";
import { createTypedRpcServiceClient } from "@vibestudio/shared/typedRpcServiceClient";
import { createApprovalsClient, type ApprovalsClient } from "@workspace/approvals-core";
import type { OwnerRpcs } from "@workspace/client-kit-web";
import { createImagesClient, type ImagesClient } from "@workspace/runtime/images";

/**
 * The chat's live connection: this device's session in the account's Personal
 * workspace. The conversation, its agents and the approvals they raise all
 * live there, so they use that routed session; the client's own principal
 * session (System) is not needed to talk.
 */
export interface ChatSession {
  readonly workspaceId: string;
  /** The participant identity the chat joins channels as. */
  readonly clientId: string;
  readonly rpc: RpcClient;
  readonly events: EventsClient;
  readonly approvals: ApprovalsClient;
  /** Authenticated, workspace-scoped image reads, over the same routed session. */
  readonly images: ImagesClient;
  close(): void;
}

/**
 * Find the Personal workspace over hub control and open this device's session
 * there. Anything that fails closes what was opened and reaches the caller
 * unchanged.
 */
export async function openChatSession(
  owners: OwnerRpcs,
  identity: { runtimeId: string }
): Promise<ChatSession> {
  const hub = owners.open({ kind: "hub" });
  let personalId: string;
  try {
    const hubControl = createTypedRpcServiceClient(
      hub.rpc,
      { targetId: "main", namespace: "hubControl" },
      hubControlMethods
    );
    const { personal } = await hubControl.ensureUserWorkspaces();
    personalId = personal.workspaceId;
  } finally {
    hub.close();
  }
  const workspace = owners.open({ kind: "workspace", workspaceId: personalId });
  return {
    workspaceId: personalId,
    clientId: identity.runtimeId,
    rpc: workspace.rpc,
    events: new EventsClient(workspace.rpc),
    approvals: createApprovalsClient(workspace.rpc),
    images: createImagesClient(workspace.rpc),
    close: () => workspace.close(),
  };
}
