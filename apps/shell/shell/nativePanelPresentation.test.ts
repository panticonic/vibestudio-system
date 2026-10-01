import { expect, it, vi } from "vitest";
import {
  NATIVE_PANEL_SURFACE_PROTOCOL_VERSION,
  type NativePanelDesiredSnapshot,
} from "@vibestudio/service-schemas/view";
import {
  createNativePanelPresentation,
  type NativePanelBridge,
} from "./nativePanelPresentation";

it("withdraws every native declaration and focus when its workspace owner retires", async () => {
  const bridge: NativePanelBridge = {
    connectNativePanelAdapter: async () => ({
      accepted: true,
      handshake: {
        protocolVersion: NATIVE_PANEL_SURFACE_PROTOCOL_VERSION,
        hostGeneration: "host",
        shellGeneration: "shell",
        sealedLaunchIdentity: "@workspace-apps/shell",
      },
    }),
    applyNativePanelSurfaces: vi.fn(
      async (snapshot: NativePanelDesiredSnapshot) => ({
        accepted: true as const,
        observation: {
          ...snapshot,
          desiredRevision: snapshot.revision,
          observationRevision: snapshot.revision,
          surfaces: snapshot.surfaces.map((surface) => ({
            ...surface,
            nativeSurfaceId: surface.surfaceId,
          })),
        },
      }),
    ),
  };
  const presentation = createNativePanelPresentation(bridge);
  const team = presentation.forWorkspace("team");
  const personal = presentation.forWorkspace("personal");
  const declaration = {
    nativeSlotId: "pane",
    bindingId: "binding",
    panelId: "panel",
    bounds: { x: 0, y: 0, width: 100, height: 100 },
  };
  await team.bindNativePanelSlot(declaration);
  await personal.bindNativePanelSlot(declaration);
  await presentation.setFocusedWorkspace("team");
  await team.close();
  const afterRetirement = vi
    .mocked(bridge.applyNativePanelSurfaces)
    .mock.calls.at(-1)![0];
  expect(afterRetirement.focusedWorkspaceId).toBeNull();
  expect(
    afterRetirement.surfaces.map(
      (surface) => surface.materialization.workspaceId,
    ),
  ).toEqual(["personal"]);
  await expect(team.bindNativePanelSlot(declaration)).rejects.toMatchObject({
    errorKind: "transport",
    code: "CONNECTION_LOST",
  });
  const transient = presentation.forWorkspace("personal");
  await transient.close();
  await team.clearNativePanelSlot(declaration);
  await personal.updateNativePanelSlot({ ...declaration, focused: true });
  const snapshot = vi
    .mocked(bridge.applyNativePanelSurfaces)
    .mock.calls.at(-1)![0];
  expect(snapshot.focusedWorkspaceId).toBeNull();
  expect(
    snapshot.surfaces.map((surface) => surface.materialization.workspaceId),
  ).toEqual(["personal"]);
  let resolveWorkspace!: (id: string) => void;
  const opening = presentation.forWorkspace(
    new Promise<string>((resolve) => {
      resolveWorkspace = resolve;
    }),
  );
  const lateBinding = opening.bindNativePanelSlot(declaration);
  await opening.close();
  resolveWorkspace("team");
  await expect(lateBinding).rejects.toMatchObject({ code: "CONNECTION_LOST" });
  const replacement = presentation.forWorkspace("team");
  await replacement.bindNativePanelSlot(declaration);
  await team.clearNativePanelSlot(declaration);
  const afterLateClear = vi
    .mocked(bridge.applyNativePanelSurfaces)
    .mock.calls.at(-1)![0];
  expect(
    afterLateClear.surfaces.map(
      (surface) => surface.materialization.workspaceId,
    ),
  ).toEqual(["personal", "team"]);
  await replacement.close();
  presentation.close();
});
