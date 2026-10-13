// @vitest-environment jsdom

import { act, render, waitFor } from "@testing-library/react";
import { RpcBoundaryError } from "@vibestudio/rpc";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { NextPanelBuildWarmup } from "./NextPanelBuildWarmup";
import { emitShellEventFixture } from "../test/shellEventFixture";

const mocks = vi.hoisted(() => ({
  warmPanel: vi.fn(),
  getFocusedPanelId: vi.fn(),
  getLocalPresentation: vi.fn(),
  eventListeners: new Map<string, Set<(payload: unknown) => void>>(),
}));

vi.mock("../shell/client", () => ({
  buildUnits: { warmPanel: mocks.warmPanel },
  panel: {
    getFocusedPanelId: mocks.getFocusedPanelId,
    getLocalPresentation: mocks.getLocalPresentation,
  },
}));
vi.mock("../shell/hooks/PanelTreeContext", () => ({
  usePanelTree: () => ({ initialized: true }),
}));
vi.mock("../shell/useShellEvent", async () => {
  const { useShellEventFixture } = await import("../test/shellEventFixture");
  return {
    useShellEvent: (
      event: string,
      listener: (value: unknown) => void,
      readSnapshot?: (signal: AbortSignal) => void | Promise<void>,
    ) =>
      useShellEventFixture(
        mocks.eventListeners,
        event,
        listener,
        readSnapshot,
      ),
  };
});

describe("NextPanelBuildWarmup", () => {
  let idleCallback: (() => void) | null;
  let cancelIdleCallback: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    idleCallback = null;
    cancelIdleCallback = vi.fn();
    mocks.warmPanel.mockReset().mockResolvedValue(undefined);
    mocks.getFocusedPanelId.mockReset().mockResolvedValue("panel:initial");
    mocks.getLocalPresentation.mockReset().mockResolvedValue({
      revision: 1,
      presentation: { state: "loading", slotId: "panel:initial" },
    });
    mocks.eventListeners.clear();
    Object.assign(window, {
      requestIdleCallback: vi.fn((callback: () => void) => {
        idleCallback = callback;
        return 41;
      }),
      cancelIdleCallback,
    });
  });

  it("does not warm during first-panel load and starts only at post-ready idle", async () => {
    render(<NextPanelBuildWarmup />);
    await waitFor(() => expect(mocks.getLocalPresentation).toHaveBeenCalled());
    expect(mocks.warmPanel).not.toHaveBeenCalled();
    expect(window.requestIdleCallback).not.toHaveBeenCalled();

    act(() => {
      emitShellEventFixture(mocks.eventListeners, "panel-local-presentation-changed", {
        revision: 2,
        presentation: { state: "ready", slotId: "panel:initial" },
      });
    });
    expect(window.requestIdleCallback).toHaveBeenCalledOnce();
    expect(mocks.warmPanel).not.toHaveBeenCalled();

    await act(async () => idleCallback?.());
    expect(mocks.warmPanel).toHaveBeenCalledOnce();
    expect(mocks.warmPanel).toHaveBeenCalledWith("about/new");
  });

  it("cancels pending speculative work when the server leaves connected", async () => {
    mocks.getLocalPresentation.mockResolvedValue({
      revision: 2,
      presentation: { state: "ready", slotId: "panel:initial" },
    });
    render(<NextPanelBuildWarmup />);
    await waitFor(() =>
      expect(window.requestIdleCallback).toHaveBeenCalledOnce(),
    );

    act(() => emitShellEventFixture(mocks.eventListeners, "server-connection-changed", { status: "connecting" }));
    expect(cancelIdleCallback).toHaveBeenCalledWith(41);
    expect(mocks.warmPanel).not.toHaveBeenCalled();
  });

  it.each(["transport", "internal"] as const)(
    "preserves real readiness diagnostics while ignoring %s connection loss",
    async (kind) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      mocks.getFocusedPanelId.mockRejectedValue(
        new RpcBoundaryError("unavailable", kind, "CONNECTION_LOST"),
      );
      try {
        render(<NextPanelBuildWarmup />);
        await waitFor(() => expect(mocks.getFocusedPanelId).toHaveBeenCalled());
        await act(async () => Promise.resolve());
        expect(warn).toHaveBeenCalledTimes(kind === "transport" ? 0 : 1);
      } finally {
        warn.mockRestore();
      }
    },
  );
});
