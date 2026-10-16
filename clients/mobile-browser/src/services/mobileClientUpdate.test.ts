import type { SupervisionChange } from "@vibestudio/shared/events";
import { createMobileClientUpdateModel } from "./mobileClientUpdate";
import type { ShellClient } from "./shellClient";

function change(over: Partial<SupervisionChange> & { runtime?: "react-native" | "web" } = {}) {
  const { runtime, ...rest } = over;
  return {
    identity: { kind: "client", entityId: "mobile" },
    source: "clients/mobile-browser",
    status: "running",
    lastError: null,
    artifact: { effectiveVersion: "1.2.0", buildKey: "build-2", executionDigest: null },
    canRollback: true,
    change: "adopted",
    previousBuildKey: "build-1",
    previousEffectiveVersion: "1.1.0",
    client: { id: "mobile", runtime: runtime ?? "react-native", grantedCapabilities: [] },
    ...rest,
  } as SupervisionChange;
}

function setup() {
  const call = jest.fn(async () => ({ releaseId: "mobile", activeBuildKey: "build-1" }));
  const transport = { call } as unknown as ShellClient["transport"];
  const ensureBundle = jest.fn(async () => undefined);
  const model = createMobileClientUpdateModel({
    shellClient: { transport } as unknown as ShellClient,
    selectedSource: "clients/mobile-browser",
    selectedClientId: "mobile",
    ensureBundle,
  });
  return { model, call, transport, ensureBundle };
}

describe("mobile client update model", () => {
  it("installs the ready build through the active transport", async () => {
    const { model, transport, ensureBundle } = setup();
    model.handleChange(change());
    await model.apply("mobile");
    expect(ensureBundle).toHaveBeenCalledWith(transport, "clients/mobile-browser");
    expect(model.getSnapshot().pending).toEqual([]);
  });

  it("rolls back on the server, then takes the restored build", async () => {
    const { model, call, transport, ensureBundle } = setup();
    model.handleChange(change());
    await model.rollback("mobile");
    expect(call).toHaveBeenCalledTimes(1);
    expect((call.mock.calls[0] as unknown[])[2]).toEqual([
      { kind: "client", releaseId: "mobile" },
    ]);
    expect(ensureBundle).toHaveBeenCalledWith(transport, "clients/mobile-browser");
  });

  it("only follows the selected source and client", () => {
    const { model } = setup();
    model.handleChange(change({ source: "clients/other" }));
    model.handleChange(change({ identity: { kind: "client", entityId: "other" } }));
    model.handleChange(change({ runtime: "web" }));
    expect(model.getSnapshot().pending).toEqual([]);
  });
});
