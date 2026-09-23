import {
  NATIVE_PANEL_SURFACE_PROTOCOL_VERSION,
  type NativePanelAdapterHello,
  type NativePanelAdapterHandshakeResult,
  type NativePanelDesiredSnapshot,
  type NativePanelApplyResult,
} from "@vibestudio/service-schemas/view";
import type { NativePanelSlotBounds } from "./workspaceClient";
type DesiredNativePanelSlot = {
  nativeSlotId: string;
  bindingId: string;
  panelId: string;
  workspaceId: string;
  bounds: NativePanelSlotBounds;
  focused: boolean;
};
export interface NativePanelBridge {
  connectNativePanelAdapter(
    hello: NativePanelAdapterHello,
  ): Promise<NativePanelAdapterHandshakeResult>;
  applyNativePanelSurfaces(
    snapshot: NativePanelDesiredSnapshot,
  ): Promise<NativePanelApplyResult>;
}

export function desktopNativePanelBridge(): NativePanelBridge & {
  openWorkspace(workspaceId: string): Promise<void>;
} {
  const bridge = (
    globalThis as typeof globalThis & {
      __vibestudioNativePanels?: NativePanelBridge & {
        openWorkspace(workspaceId: string): Promise<void>;
      };
    }
  ).__vibestudioNativePanels;
  if (!bridge) throw new Error("Desktop native panel bridge is unavailable");
  return bridge;
}

/** One local compositor session; server availability never gates layout. */
export function createNativePanelPresentation(bridge: NativePanelBridge) {
  const desiredNativePanelSlots = new Map<string, DesiredNativePanelSlot>();
  let focusedWorkspaceId: string | null = null;
  let desiredNativePanelSlotRevision = 0;
  let nativePanelSyncTail = Promise.resolve();
  let nativePanelAdapterHandshake: {
    hostGeneration: string;
    shellGeneration: string;
  };
  let nativePanelAdapterConnection: Promise<void> | null = null;
  let closed = false;
  let requestedSync = 0;
  let syncSnapshot: { error: string | null } = { error: null };
  const syncListeners = new Set<() => void>();
  const publishSyncError = (error: string | null) => {
    if (syncSnapshot.error === error) return;
    syncSnapshot = { error };
    for (const listener of syncListeners) listener();
  };
  const connectNativePanelAdapter = () => {
    nativePanelAdapterConnection ??= bridge
      .connectNativePanelAdapter({
        sealedLaunchIdentity: "@workspace-apps/shell",
        supportedProtocolVersions: [NATIVE_PANEL_SURFACE_PROTOCOL_VERSION],
      })
      .then((result) => {
        if (!result.accepted)
          throw new Error(`Panel host rejected shell: ${result.reason}`);
        nativePanelAdapterHandshake = result.handshake;
        desiredNativePanelSlotRevision = 0;
      })
      .catch((error) => {
        nativePanelAdapterConnection = null;
        throw error;
      });
    return nativePanelAdapterConnection;
  };
  const syncDesiredNativePanelSlots = () => {
    const request = ++requestedSync;
    const apply = async () => {
      if (closed) throw new Error("Native panel presentation is closed");
      await connectNativePanelAdapter();
      if (closed) throw new Error("Native panel presentation is closed");
      const revision = ++desiredNativePanelSlotRevision;
      const result = await bridge.applyNativePanelSurfaces({
        protocolVersion: NATIVE_PANEL_SURFACE_PROTOCOL_VERSION,
        focusedWorkspaceId,
        hostGeneration: nativePanelAdapterHandshake.hostGeneration,
        shellGeneration: nativePanelAdapterHandshake.shellGeneration,
        revision,
        surfaces: [...desiredNativePanelSlots.values()].map((slot) => ({
          surfaceId: slot.nativeSlotId,
          materialization: {
            workspaceId: slot.workspaceId,
            runtimeEntityId: slot.panelId,
            leaseConnectionId: slot.bindingId,
          },
          visible: true,
          focused: slot.focused,
          bounds: slot.bounds,
        })),
      });
      if (!result.accepted)
        throw new Error(
          `Native panel adapter rejected desired state: ${result.reason}`,
        );
      return result.observation;
    };
    const current = nativePanelSyncTail.then(apply, apply).then(
      (observation) => {
        if (request === requestedSync) publishSyncError(null);
        return observation;
      },
      (error) => {
        if (request === requestedSync)
          publishSyncError(
            error instanceof Error ? error.message : String(error),
          );
        throw error;
      },
    );
    nativePanelSyncTail = current.then(
      () => undefined,
      () => undefined,
    );
    return current;
  };

  return {
    subscribe(listener: () => void) {
      syncListeners.add(listener);
      return () => syncListeners.delete(listener);
    },
    getSnapshot() {
      return syncSnapshot;
    },
    setFocusedWorkspace(workspaceId: string | null) {
      focusedWorkspaceId = workspaceId;
      return syncDesiredNativePanelSlots();
    },
    connectNativePanelAdapter,
    close() {
      if (closed) return;
      closed = true;
      syncListeners.clear();
      desiredNativePanelSlots.clear();
    },
    forWorkspace(workspaceId: string | Promise<string>) {
      return {
        bindNativePanelSlot: async (request: {
          nativeSlotId: string;
          bindingId: string;
          panelId: string;
          bounds: NativePanelSlotBounds;
          focused?: boolean;
        }) => {
          const ownerWorkspaceId = await workspaceId;
          const surfaceId = JSON.stringify([
            ownerWorkspaceId,
            request.nativeSlotId,
          ]);
          desiredNativePanelSlots.set(surfaceId, {
            nativeSlotId: surfaceId,
            workspaceId: ownerWorkspaceId,
            bindingId: request.bindingId,
            panelId: request.panelId,
            bounds: request.bounds,
            focused: request.focused === true,
          });
          const observed = await syncDesiredNativePanelSlots();
          return observed.surfaces.some(
            (surface) => surface.surfaceId === surfaceId,
          )
            ? { status: "bound" as const }
            : {
                status: "missing" as const,
                reason: `native adapter did not observe ${request.nativeSlotId}`,
              };
        },
        updateNativePanelSlot: async (request: {
          nativeSlotId: string;
          bindingId: string;
          bounds?: NativePanelSlotBounds;
          focused?: boolean;
        }) => {
          const surfaceId = JSON.stringify([
            await workspaceId,
            request.nativeSlotId,
          ]);
          const current = desiredNativePanelSlots.get(surfaceId);
          if (!current || current.bindingId !== request.bindingId) {
            return {
              status: "missing" as const,
              reason: `unknown native panel slot: ${request.nativeSlotId}`,
            };
          }
          desiredNativePanelSlots.set(surfaceId, {
            ...current,
            ...(request.bounds ? { bounds: request.bounds } : {}),
            ...(typeof request.focused === "boolean"
              ? { focused: request.focused }
              : {}),
          });
          const observed = await syncDesiredNativePanelSlots();
          return observed.surfaces.some(
            (surface) => surface.surfaceId === surfaceId,
          )
            ? { status: "updated" as const }
            : {
                status: "missing" as const,
                reason: `native adapter did not observe ${request.nativeSlotId}`,
              };
        },
        clearNativePanelSlot: async (request: {
          nativeSlotId: string;
          bindingId: string;
        }) => {
          const surfaceId = JSON.stringify([
            await workspaceId,
            request.nativeSlotId,
          ]);
          const current = desiredNativePanelSlots.get(surfaceId);
          if (current?.bindingId === request.bindingId) {
            desiredNativePanelSlots.delete(surfaceId);
            await syncDesiredNativePanelSlots();
          }
        },
      };
    },
  };
}
export type NativePanelPresentation = ReturnType<
  typeof createNativePanelPresentation
>;
