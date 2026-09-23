import { describe, expect, it, vi } from "vitest";
import { type RpcClient } from "@vibestudio/rpc";
import type {
  NativePanelAdapterHandshakeResult,
  NativePanelApplyResult,
  NativePanelDesiredSnapshot,
} from "@vibestudio/service-schemas/view";
import { createNativePanelPresentation } from "./nativePanelPresentation";
import { createShellWorkspaceClient } from "./workspaceClient";

function nativeSession(workspaceId: string) {
  const bridge = {
    connectNativePanelAdapter: vi.fn(
      async (): Promise<NativePanelAdapterHandshakeResult> => ({
        accepted: true,
        handshake: {
          protocolVersion: 2,
          hostGeneration: workspaceId,
          shellGeneration: "shell",
          sealedLaunchIdentity: "@workspace-apps/shell",
        },
      }),
    ),
    applyNativePanelSurfaces: vi.fn(
      async (
        desired: NativePanelDesiredSnapshot,
      ): Promise<NativePanelApplyResult> => {
        return {
          accepted: true,
          observation: {
            protocolVersion: 2,
            hostGeneration: workspaceId,
            shellGeneration: "shell",
            desiredRevision: desired.revision,
            observationRevision: desired.revision,
            focusedWorkspaceId: desired.focusedWorkspaceId,
            surfaces: desired.surfaces.map((surface) => ({
              ...surface,
              nativeSurfaceId: workspaceId + ":" + surface.surfaceId,
            })),
          },
        };
      },
    ),
  };
  const rpc = {
    call: vi.fn().mockRejectedValue(new Error("server offline")),
    on: vi.fn(() => () => {}),
    onStatusChange: vi.fn(() => () => {}),
    selfId: workspaceId,
  } as unknown as RpcClient;
  return {
    rpc,
    client: createShellWorkspaceClient(rpc, {
      hubRpc: rpc,
      workspaceId,
      nativePresentation: createNativePanelPresentation(bridge),
    }),
    bridge,
  };
}
const slot = {
  nativeSlotId: "pane-1",
  bindingId: "lease-1",
  panelId: "panel-1",
  bounds: { x: 0, y: 0, width: 400, height: 300 },
  focused: true,
};
describe("workspace-owned shell clients", () => {
  it("keeps identically named native panel slots and revisions separate", async () => {
    const personal = nativeSession("personal");
    const project = nativeSession("project");
    expect(await personal.client.view.bindNativePanelSlot(slot)).toEqual({
      status: "bound",
    });
    expect(
      await project.client.view.updateNativePanelSlot({
        nativeSlotId: slot.nativeSlotId,
        bindingId: slot.bindingId,
      }),
    ).toEqual({
      status: "missing",
      reason: "unknown native panel slot: pane-1",
    });
    await project.client.view.bindNativePanelSlot({
      ...slot,
      panelId: "project-panel",
    });
    await personal.client.view.clearNativePanelSlot({
      nativeSlotId: slot.nativeSlotId,
      bindingId: slot.bindingId,
    });
    const projectCalls = project.bridge.applyNativePanelSurfaces.mock.calls;
    expect(projectCalls).toHaveLength(1);
    expect(projectCalls[0]?.[0]).toMatchObject({
      hostGeneration: "project",
      revision: 1,
      surfaces: [{ materialization: { runtimeEntityId: "project-panel" } }],
    });
    const personalCalls = personal.bridge.applyNativePanelSurfaces.mock.calls;
    expect(personalCalls[1]?.[0]).toMatchObject({
      hostGeneration: "personal",
      revision: 2,
      surfaces: [],
    });
  });
  it("retains the original client in a captured handler after another workspace is created", async () => {
    const personal = nativeSession("personal");
    const captured = () => personal.client.view.bindNativePanelSlot(slot);
    const project = nativeSession("project");
    await captured();
    expect(personal.bridge.applyNativePanelSurfaces).toHaveBeenCalled();
    expect(project.bridge.applyNativePanelSurfaces).not.toHaveBeenCalled();
  });
  it("converges one shared native compositor without colliding equal local panel slots", async () => {
    const host = nativeSession("system");
    const native = createNativePanelPresentation(host.bridge);
    const personal = native.forWorkspace("personal");
    const project = native.forWorkspace("project");
    await personal.bindNativePanelSlot(slot);
    await project.bindNativePanelSlot(slot);
    const snapshots = host.bridge.applyNativePanelSurfaces.mock.calls;
    const second = snapshots.at(-1)![0];
    expect(second.surfaces).toHaveLength(2);
    expect(
      new Set(second.surfaces.map((surface) => surface.surfaceId)).size,
    ).toBe(2);
    expect(
      second.surfaces.map((surface) => surface.materialization.workspaceId),
    ).toEqual(["personal", "project"]);
    await personal.clearNativePanelSlot({
      nativeSlotId: slot.nativeSlotId,
      bindingId: slot.bindingId,
    });
    expect(snapshots.at(-1)?.[0]).toMatchObject({
      revision: 3,
      surfaces: [
        {
          materialization: {
            workspaceId: "project",
            runtimeEntityId: "panel-1",
          },
        },
      ],
    });
  });
});

describe("local native presentation", () => {
  it("updates notice geometry and clears panels without a workspace RPC connection", async () => {
    const host = nativeSession("system");
    const native = createNativePanelPresentation(host.bridge);
    const personal = native.forWorkspace("personal");
    await personal.bindNativePanelSlot(slot);
    // The workspace transport is unusable. The compositor has its own IPC bridge.
    await personal.updateNativePanelSlot({
      ...slot,
      bounds: { x: 272, y: 80, width: 600, height: 500 },
    });
    const updates = host.bridge.applyNativePanelSurfaces.mock.calls;
    expect(updates.at(-1)?.[0]).toMatchObject({
      surfaces: [{ bounds: { y: 80, height: 500 } }],
    });
    await personal.clearNativePanelSlot(slot);
    expect(host.rpc.call).not.toHaveBeenCalled();
    expect(host.rpc.onStatusChange).not.toHaveBeenCalled();
    native.close();
  });
});
