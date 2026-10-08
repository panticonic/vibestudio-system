// @vitest-environment jsdom

import { act, render, waitFor } from "@testing-library/react";
import { RpcBoundaryError } from "@vibestudio/rpc";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { NextPanelBuildWarmup } from "./NextPanelBuildWarmup";

const mocks = vi.hoisted(() => ({
  warmPanel: vi.fn(),
  getFocusedPanelId: vi.fn(),
  getLocalPresentation: vi.fn(),
  presentationListener: null as ((value: unknown) => void) | null,
  connectionListener: null as ((value: { status: string }) => void) | null,
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
vi.mock("../shell/useShellEvent", () => ({
  useShellEvent: (event: string, listener: (value: unknown) => void) => {
    if (event === "panel-local-presentation-changed")
      mocks.presentationListener = listener;
    if (event === "server-connection-changed")
      mocks.connectionListener = listener;
  },
}));

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
    mocks.presentationListener = null;
    mocks.connectionListener = null;
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
      mocks.presentationListener?.({
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

    act(() => mocks.connectionListener?.({ status: "connecting" }));
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
