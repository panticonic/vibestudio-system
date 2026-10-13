import {
  handleMobileSupervisionChange,
  type AppUpdatePromptDeps,
} from "./appUpdatePrompt";
import type { ShellClient } from "./shellClient";
import type { SupervisionChange } from "@vibestudio/shared/events";

function mobileChange(
  over: {
    change?: SupervisionChange["change"];
    buildKey?: string | null;
    effectiveVersion?: string | null;
    previousBuildKey?: string | null;
    previousEffectiveVersion?: string | null;
    lastError?: string | null;
    canRollback?: boolean;
    source?: string;
  } = {},
): SupervisionChange {
  return {
    identity: { kind: "app", entityId: "apps/mobile" },
    source: over.source ?? "apps/mobile",
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
    adoption: "prompt",
    app: { target: "react-native", capabilities: [] },
  };
}

function makeDeps(overrides: Partial<AppUpdatePromptDeps> = {}): {
  deps: AppUpdatePromptDeps;
  alert: jest.Mock;
  ensureBundle: jest.Mock;
} {
  const alert = jest.fn();
  const ensureBundle = jest.fn().mockResolvedValue(undefined);
  const shellClient = {
    transport: { streamReadable: jest.fn() },
  } as unknown as ShellClient;
  const deps: AppUpdatePromptDeps = {
    shellClient,
    pushToast: jest.fn(),
    prompted: new Set<string>(),
    selectedSource: null,
    selectedAppId: null,
    alert: alert as unknown as typeof import("react-native").Alert.alert,
    ensureBundle:
      ensureBundle as unknown as AppUpdatePromptDeps["ensureBundle"],
    ...overrides,
  };
  return { deps, alert, ensureBundle };
}

describe("handleMobileSupervisionChange (update-available)", () => {
  it("surfaces both versions when the server reports a transition", () => {
    const { deps, alert } = makeDeps();
    handleMobileSupervisionChange(
      mobileChange({ buildKey: "build-2", effectiveVersion: "1.2.0", previousBuildKey: "build-1", previousEffectiveVersion: "1.1.0" }),
      deps,
    );
    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert.mock.calls[0][1]).toBe(
      "apps/mobile v1.1.0 → v1.2.0 is ready to install.",
    );
  });

  it("surfaces just the target version when no previous version is known", () => {
    const { deps, alert } = makeDeps();
    handleMobileSupervisionChange(
      mobileChange({ buildKey: "build-2", effectiveVersion: "1.2.0" }),
      deps,
    );
    expect(alert.mock.calls[0][1]).toBe(
      "apps/mobile v1.2.0 is ready to install.",
    );
  });

  it("falls back to generic copy when no versions are reported", () => {
    const { deps, alert } = makeDeps();
    handleMobileSupervisionChange(
      mobileChange({ buildKey: "build-2" }),
      deps,
    );
    expect(alert.mock.calls[0][1]).toBe(
      "apps/mobile has a new trusted bundle ready to install.",
    );
  });

  it("ignores a no-op event whose build is already the running build", () => {
    const { deps, alert } = makeDeps();
    handleMobileSupervisionChange(
      mobileChange({ buildKey: "build-1", previousBuildKey: "build-1" }),
      deps,
    );
    expect(alert).not.toHaveBeenCalled();
  });

  it("prompts only once per build key", () => {
    const { deps, alert } = makeDeps();
    const event = mobileChange({
      buildKey: "build-2",
      effectiveVersion: "1.2.0",
    });
    handleMobileSupervisionChange(event, deps);
    handleMobileSupervisionChange(event, deps);
    expect(alert).toHaveBeenCalledTimes(1);
  });

  it("installs through the active Iroh transport", () => {
    const { deps, alert, ensureBundle } = makeDeps();
    handleMobileSupervisionChange(
      mobileChange({ buildKey: "build-2", source: "apps/mobile" }),
      deps,
    );
    const buttons = alert.mock.calls[0][2];
    buttons[1].onPress();
    expect(ensureBundle).toHaveBeenCalledWith(
      deps.shellClient.transport,
      "apps/mobile",
    );
  });
});

describe("handleMobileSupervisionChange (refusals and rollbacks)", () => {
  it("tells the user an update was not adopted and that the old version runs", () => {
    const { deps } = makeDeps();
    handleMobileSupervisionChange(
      mobileChange({
        change: "update-rejected",
        lastError: "bundle failed to build",
      }),
      deps,
    );
    expect(deps.pushToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Update not adopted",
        message: "bundle failed to build The previous version keeps running.",
      }),
    );
  });

  it("confirms a rollback", () => {
    const { deps } = makeDeps();
    handleMobileSupervisionChange(
      mobileChange({ change: "rolled-back" }),
      deps,
    );
    expect(deps.pushToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "App rolled back" }),
    );
  });

  it("ignores changes to other targets", () => {
    const { deps, alert } = makeDeps();
    const change = mobileChange({ buildKey: "build-2" });
    handleMobileSupervisionChange(
      { ...change, app: { target: "electron", capabilities: [] } },
      deps,
    );
    expect(alert).not.toHaveBeenCalled();
    expect(deps.pushToast).not.toHaveBeenCalled();
  });
});
