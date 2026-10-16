import { describe, expect, it, vi } from "vitest";
import type { SupervisionChange } from "@vibestudio/shared/events";
import {
  clientUpdateMessage,
  createClientUpdateModel,
  isScopedClientChange,
  type ClientUpdatePort,
} from "./index.js";

function change(overrides: Partial<SupervisionChange> = {}): SupervisionChange {
  return {
    identity: { kind: "client", entityId: "clients/mobile-browser" },
    source: "clients/mobile-browser",
    status: "running",
    lastError: null,
    artifact: { effectiveVersion: "2", buildKey: "b2", executionDigest: null },
    canRollback: true,
    change: "adopted",
    previousBuildKey: "b1",
    previousEffectiveVersion: "1",
    client: { id: "mobile", runtime: "react-native", grantedCapabilities: [] },
    ...overrides,
  };
}

const port = (): ClientUpdatePort => ({
  apply: vi.fn(async () => undefined),
  rollback: vi.fn(async () => undefined),
});
const scope = { runtime: "react-native" as const, source: "/clients/mobile-browser/" };

describe("client update model", () => {
  it("scopes to the runtime and source it is shown for, normalizing slashes", () => {
    expect(isScopedClientChange(change(), scope)).toBe(true);
    expect(isScopedClientChange(change({ client: { id: "x", runtime: "web", grantedCapabilities: [] } }), scope)).toBe(false);
    expect(isScopedClientChange(change({ source: "clients/other" }), scope)).toBe(false);
    expect(isScopedClientChange(change({ identity: { kind: "extension", entityId: "e" } }), scope)).toBe(false);
  });

  it("offers an adopted build once and ignores a re-emitted running build", () => {
    const model = createClientUpdateModel({ scope, port: port() });
    model.handleChange(change({ previousBuildKey: "b2" }));
    expect(model.getSnapshot().pending).toEqual([]);
    model.handleChange(change());
    expect(model.getSnapshot().pending).toHaveLength(1);
    model.postpone("clients/mobile-browser");
    model.handleChange(change());
    expect(model.getSnapshot().pending).toEqual([]);
    model.handleChange(change({ artifact: { effectiveVersion: "3", buildKey: "b3", executionDigest: null } }));
    expect(model.getSnapshot().pending[0]?.toVersion).toBe("3");
  });

  it("says plainly when an update was refused or the client rolled back", () => {
    const model = createClientUpdateModel({ scope, port: port() });
    model.handleChange(change({ change: "update-rejected", lastError: "bad signature" }));
    model.handleChange(change({ change: "rolled-back" }));
    const notices = model.getSnapshot().notices;
    expect(notices.map((notice) => notice.tone)).toEqual(["danger", "success"]);
    expect(notices[0]?.message).toContain("bad signature");
    expect(notices[0]?.message).toContain("previous version keeps running");
  });

  it("applies through the host's port and clears the pending update", async () => {
    const p = port();
    const model = createClientUpdateModel({ scope, port: p });
    model.handleChange(change());
    await model.apply("clients/mobile-browser");
    expect(p.apply).toHaveBeenCalledWith(expect.objectContaining({ buildKey: "b2" }));
    expect(model.getSnapshot()).toMatchObject({ pending: [], busy: null });
  });

  it("keeps the update pending when apply fails, reports why and rethrows", async () => {
    const p = port();
    vi.mocked(p.apply).mockRejectedValueOnce(new Error("bundle fetch failed"));
    const model = createClientUpdateModel({ scope, port: p });
    model.handleChange(change());
    await expect(model.apply("clients/mobile-browser")).rejects.toThrow("bundle fetch failed");
    expect(model.getSnapshot().pending).toHaveLength(1);
    expect(model.getSnapshot().notices[0]).toMatchObject({ tone: "danger", title: "Update failed" });
  });

  it("states the versions it replaces when it knows them", () => {
    const model = createClientUpdateModel({ scope, port: port() });
    model.handleChange(change());
    expect(clientUpdateMessage(model.getSnapshot().pending[0]!)).toBe(
      "clients/mobile-browser v1 → v2 is ready to install."
    );
  });
});
