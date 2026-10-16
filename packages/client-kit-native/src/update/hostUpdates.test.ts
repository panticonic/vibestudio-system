import type { SupervisionChange } from "@vibestudio/shared/events";
import type { UpdateOffer } from "@vibestudio/rn-client-api";
import { createFakeClientHost } from "../testing/fakeClientHost";
import {
  clientUpdatePortFromHost,
  createHostUpdateModel,
  observeHostUpdates,
} from "./hostUpdates";

function change(
  over: { buildKey?: string; source?: string; canRollback?: boolean } = {},
): SupervisionChange {
  return {
    identity: { kind: "client", entityId: "browser" },
    source: over.source ?? "clients/mobile-browser",
    status: "running",
    lastError: null,
    artifact: {
      effectiveVersion: "1.2.0",
      buildKey: over.buildKey ?? "build-2",
      executionDigest: null,
    },
    canRollback: over.canRollback ?? true,
    change: "adopted",
    previousBuildKey: "build-1",
    previousEffectiveVersion: "1.1.0",
    client: { id: "browser", runtime: "react-native", grantedCapabilities: [] },
  };
}

function offer(over: Parameters<typeof change>[0] = {}): UpdateOffer {
  const value = change(over);
  return {
    buildKey: value.artifact.buildKey ?? "",
    effectiveVersion: value.artifact.effectiveVersion,
    previousBuildKey: "build-1",
    change: value,
  };
}

describe("host updates", () => {
  it("applies and rolls back by asking the host", async () => {
    const fake = await createFakeClientHost();
    const model = createHostUpdateModel(fake.api);
    model.handleChange(change());

    await model.apply("browser");
    expect(fake.callsOf("updates.restartAtSafePoint")).toHaveLength(1);

    model.handleChange(change({ buildKey: "build-3" }));
    await model.rollback("browser");
    expect(fake.callsOf("updates.rollback")).toHaveLength(1);
  });

  it("surfaces a failed host restart as a notice and rethrows", async () => {
    const fake = await createFakeClientHost({
      handlers: {
        "updates.restartAtSafePoint": () => {
          throw new Error("the host refused");
        },
      },
    });
    const model = createHostUpdateModel(fake.api);
    model.handleChange(change());

    await expect(model.apply("browser")).rejects.toThrow("the host refused");
    expect(model.getSnapshot().notices.map((notice) => notice.title)).toEqual(["Update failed"]);
  });

  it("starts from the offer the host already holds", async () => {
    const fake = await createFakeClientHost({ pending: offer() });
    const model = createHostUpdateModel(fake.api);
    const stop = observeHostUpdates(fake.api, model);
    expect(model.getSnapshot().pending.map((update) => update.buildKey)).toEqual(["build-2"]);
    stop();
  });

  it("follows later offers and stops following when retired", async () => {
    const fake = await createFakeClientHost();
    const model = createHostUpdateModel(fake.api);
    const stop = observeHostUpdates(fake.api, model);
    expect(model.getSnapshot().pending).toEqual([]);

    fake.emit({ type: "update", update: offer({ buildKey: "build-4" }) });
    expect(model.getSnapshot().pending.map((update) => update.buildKey)).toEqual(["build-4"]);

    stop();
    model.postpone("browser");
    fake.emit({ type: "update", update: offer({ buildKey: "build-5" }) });
    expect(model.getSnapshot().pending).toEqual([]);
  });

  it("follows only this client's source", async () => {
    const fake = await createFakeClientHost();
    const model = createHostUpdateModel(fake.api);
    observeHostUpdates(fake.api, model);
    fake.emit({ type: "update", update: offer({ source: "clients/other" }) });
    expect(model.getSnapshot().pending).toEqual([]);
  });

  it("exposes the port the prompt drives", async () => {
    const fake = await createFakeClientHost();
    const port = clientUpdatePortFromHost(fake.api);
    const update = {
      clientId: "browser",
      source: "clients/mobile-browser",
      runtime: "react-native" as const,
      buildKey: "build-2",
      toVersion: null,
      fromVersion: null,
      canRollback: false,
    };
    await port.apply(update);
    await port.rollback(update);
    expect(fake.callsOf("updates.restartAtSafePoint")).toHaveLength(1);
    expect(fake.callsOf("updates.rollback")).toHaveLength(1);
  });
});
