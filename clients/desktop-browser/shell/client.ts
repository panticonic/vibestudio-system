import { createRecoveryCoordinator } from "@vibestudio/shell-core/recoveryCoordinator";
/** Stable startup client and exports used by shell entry points. */
import type { RpcDestination, RpcClient } from "@vibestudio/rpc";
import {
  createOwnerRpcs,
  type NativeWorkspaceConnectionBridge,
  type OwnerTransport,
} from "@workspace/client-kit-web";
import { assertPresent } from "../utils/assertPresent";
import {
  createNativePanelPresentation,
  desktopNativePanelBridge,
} from "./nativePanelPresentation";
import { EventsClient } from "@vibestudio/service-schemas/clients/eventsClient";
import {
  createShellApprovalClient,
  createShellWorkspaceClient,
} from "./workspaceClient";
export * from "./workspaceClient";
const g = globalThis as unknown as {
  __vibestudioWorkspaceConnection?: NativeWorkspaceConnectionBridge;
  __vibestudioTransport?: OwnerTransport;
};
if (!g.__vibestudioTransport) throw new Error("Shell transport not available");
const owners = createOwnerRpcs({
  transport: g.__vibestudioTransport,
  connection: assertPresent(g.__vibestudioWorkspaceConnection),
});
const systemOwner = createOwnerRpc({
  kind: "workspace",
  workspaceId: g.__vibestudioTransport.identity.workspaceId,
});
const rpc: RpcClient = systemOwner.rpc;
const hubOwner = createOwnerRpc({ kind: "hub" });
export const hubRpc = hubOwner.rpc;
export const hubApprovalSource = {
  owner: { kind: "hub" as const },
  shellApproval: createShellApprovalClient(hubRpc, new EventsClient(hubRpc)),
};
export const systemWorkspaceId = Promise.resolve(
  g.__vibestudioTransport.identity.workspaceId,
);
export const nativePanelPresentation = createNativePanelPresentation(
  desktopNativePanelBridge(),
);
export const startupWorkspaceClient = createShellWorkspaceClient(rpc, {
  workspaceId: systemWorkspaceId,
  nativePresentation: nativePanelPresentation,
  hubRpc,
  recoveryCoordinator: systemOwner.recoveryCoordinator,
});
/** The startup workspace client; never rebound when focus changes. */
export const {
  problemReports,
  unitIcons,
  websiteConnections,
  app,
  panel,
  hostCommands,
  connectNativePanelAdapter,
  view,
  nativeShellOverlay,
  contentOverlay,
  shellNetwork,
  incomingPairLink,
  incomingShellSurface,
  incomingPanelLocation,
  menu,
  workspace,
  templates,
  credentials,
  sourceFiles,
  vcs,
  remoteCred,
  hubControl,
  autofill,
  blobstore,
  workspacePresence,
  ACCOUNT_PROFILE_CHANGED_EVENT,
  account,
  userNotifications,
  events,
  directEvents,
  notification,
  extensions,
  browserData,
  browserEnvironment,
  supervisedUnits,
  buildUnits,
  shellApproval,
  shellPresence,
  quickfire,
  connectToChannel,
} = startupWorkspaceClient;

/** One captured RPC owner; focus changes cannot retarget it. */
function createOwnerRpc(destination: RpcDestination) {
  const recoveryCoordinator = createRecoveryCoordinator();
  const owner = owners.open(destination, { recovery: recoveryCoordinator });
  return { rpc: owner.rpc, recoveryCoordinator, close: owner.close };
}
/** A captured target client. Desktop UI admission is enforced at the native IPC boundary. */
export async function createWorkspaceShellClient(workspaceId: string) {
  await desktopNativePanelBridge().openWorkspace(workspaceId);
  const owner = createOwnerRpc({ kind: "workspace", workspaceId });
  const scopedRpc = owner.rpc;
  const scoped = createShellWorkspaceClient(scopedRpc, {
    workspaceId,
    nativePresentation: nativePanelPresentation,
    hubRpc,
    recoveryCoordinator: owner.recoveryCoordinator,
  });
  const client = {
    ...scoped,
    // Account/device management has one System presentation owner. Native
    // workspace navigation, panels and Quickfire keep their scoped clients.
      hubControl,
    account,
    remoteCred,
    incomingPairLink,
    incomingShellSurface,
    incomingPanelLocation,
    shellNetwork,
    nativeShellOverlay,
    contentOverlay,
    workspace: {
      ...workspace,
      getActive: scoped.workspace.getActive,
      getConfig: scoped.workspace.getConfig,
    },
  };
  return {
    client,
    close() {
      // The compositor publishes synchronization failures to its observed state.
      void scoped.view.close().catch(() => undefined);
      scoped.unitIcons.close();
      owner.close();
    },
  };
}
