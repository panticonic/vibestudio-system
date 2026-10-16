import {
  createClientUpdateModel,
  type ClientUpdatePort,
} from "@workspace/client-update-core";
import type { SupervisionChange } from "@vibestudio/shared/events";
import { presentClientUpdates } from "./clientUpdatePrompt";

function mobileChange(
  over: {
    change?: SupervisionChange["change"];
    buildKey?: string | null;
    effectiveVersion?: string | null;
    previousBuildKey?: string | null;
    previousEffectiveVersion?: string | null;
    lastError?: string | null;
    canRollback?: boolean;
    runtime?: "react-native" | "web" | "terminal";
  } = {},
): SupervisionChange {
  return {
    identity: { kind: "client", entityId: "clients/mobile-browser" },
    source: "clients/mobile-browser",
    status: "running",
    lastError: over.lastError ?? null,
    artifact: {
      effectiveVersion: over.effectiveVersion ?? null,
      buildKey: over.buildKey ?? null,
      executionDigest: null,
    },
    canRollback: over.canRollback ?? false,
    change: over.change ?? "adopted",
    previousBuildKey: over.previousBuildKey ?? null,
    previousEffectiveVersion: over.previousEffectiveVersion ?? null,
    client: {
      id: "mobile-browser",
      runtime: over.runtime ?? "react-native",
      grantedCapabilities: [],
    },
  };
}

function setup() {
  const port: ClientUpdatePort = {
    apply: jest.fn(async () => undefined),
    rollback: jest.fn(async () => undefined),
  };
  const model = createClientUpdateModel({
    scope: { runtime: "react-native", source: null, clientId: null },
    port,
  });
  const alert = jest.fn();
  const notify = jest.fn();
  const stop = presentClientUpdates(model, {
    alert: alert as never,
    notify,
  });
  return { model, port, alert, notify, stop };
}

describe("presentClientUpdates", () => {
  it("asks once per ready build, with both versions when the server reports a transition", () => {
    const { model, alert } = setup();
    const change = mobileChange({
      buildKey: "build-2",
      effectiveVersion: "1.2.0",
      previousBuildKey: "build-1",
      previousEffectiveVersion: "1.1.0",
    });
    model.handleChange(change);
    model.handleChange(change);
    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert.mock.calls[0][0]).toBe("Mobile app update available");
    expect(alert.mock.calls[0][1]).toBe(
      "clients/mobile-browser v1.1.0 → v1.2.0 is ready to install.",
    );
  });

  it("does not ask for the build that is already running", () => {
    const { model, alert } = setup();
    model.handleChange(mobileChange({ buildKey: "build-1", previousBuildKey: "build-1" }));
    expect(alert).not.toHaveBeenCalled();
  });

  it("installs through the port when the person chooses Install", async () => {
    const { model, port, alert } = setup();
    model.handleChange(mobileChange({ buildKey: "build-2" }));
    const buttons = alert.mock.calls[0][2];
    expect(buttons.map((button: { text: string }) => button.text)).toEqual(["Later", "Install"]);
    buttons[1].onPress();
    await Promise.resolve();
    expect(port.apply).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: "clients/mobile-browser", buildKey: "build-2" }),
    );
  });

  it("offers a roll back only when the server says one exists, and rolls back through the port", async () => {
    const { model, port, alert } = setup();
    model.handleChange(mobileChange({ buildKey: "build-2", canRollback: true }));
    const buttons = alert.mock.calls[0][2];
    expect(buttons.map((button: { text: string }) => button.text)).toEqual([
      "Later",
      "Roll back",
      "Install",
    ]);
    buttons[1].onPress();
    await Promise.resolve();
    expect(port.rollback).toHaveBeenCalledTimes(1);
  });

  it("postpones on Later without applying", () => {
    const { model, port, alert } = setup();
    model.handleChange(mobileChange({ buildKey: "build-2" }));
    alert.mock.calls[0][2][0].onPress();
    expect(model.getSnapshot().pending).toEqual([]);
    expect(port.apply).not.toHaveBeenCalled();
  });

  it("tells the person a failed install, once, and keeps the failure for the model", async () => {
    const { model, port, notify, alert } = setup();
    (port.apply as jest.Mock).mockRejectedValueOnce(new Error("disk full"));
    model.handleChange(mobileChange({ buildKey: "build-2" }));
    alert.mock.calls[0][2][1].onPress();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith({
      title: "Update failed",
      message: "disk full",
      tone: "danger",
      durationMs: 10_000,
    });
    expect(model.getSnapshot().notices).toEqual([]);
  });

  it("tells the person an update was refused and a rollback happened", () => {
    const { model, notify } = setup();
    model.handleChange(mobileChange({ change: "update-rejected", lastError: "bundle failed to build" }));
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Update not adopted",
        message: "bundle failed to build The previous version keeps running.",
        tone: "danger",
      }),
    );
    model.handleChange(mobileChange({ change: "rolled-back" }));
    expect(notify).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: "Client rolled back", tone: "success" }),
    );
  });

  it("ignores another runtime's clients", () => {
    const { model, alert, notify } = setup();
    model.handleChange(mobileChange({ buildKey: "build-2", runtime: "web" }));
    expect(alert).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });
});
