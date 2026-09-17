// @vitest-environment jsdom
import { act, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const bridge = vi.hoisted(() => ({
  setShellOverlay: vi.fn<(active: boolean) => Promise<void>>(),
  connected: null as null | ((event: { status: string }) => void),
}));
vi.mock("./client", () => ({
  view: { setShellOverlay: bridge.setShellOverlay },
}));
vi.mock("./useShellEvent", () => ({
  useShellEvent: (_event: string, callback: typeof bridge.connected) => {
    bridge.connected = callback;
  },
}));
import { useSyncShellOverlay } from "./useSyncShellOverlay";

function Window({ reviewOpen }: { reviewOpen: boolean }) {
  useSyncShellOverlay(reviewOpen);
  return null;
}
function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
afterEach(() => {
  vi.restoreAllMocks();
  bridge.setShellOverlay.mockReset();
});

describe("native review visibility", () => {
  it("waits for a delayed panel-show write before hiding panels for the next review", async () => {
    const admission = deferred();
    let nativeOverlay = false;
    bridge.setShellOverlay
      .mockImplementationOnce(async (active) => {
        await admission.promise;
        nativeOverlay = active;
      })
      .mockImplementation(async (active) => {
        nativeOverlay = active;
      });
    const window = render(<Window reviewOpen={false} />);
    await waitFor(() =>
      expect(bridge.setShellOverlay).toHaveBeenCalledTimes(1),
    );
    window.rerender(<Window reviewOpen />);
    await act(async () => {});
    // Sending true concurrently lets an older false finish last after remote
    // admission and expose a native panel over the still-open review.
    await act(async () => admission.resolve());
    await waitFor(() => expect(nativeOverlay).toBe(true));
    expect(bridge.setShellOverlay.mock.calls).toEqual([[false], [true]]);
    window.unmount();
  });

  it("does not replay a closed review between two open reviews", async () => {
    const admission = deferred();
    bridge.setShellOverlay
      .mockImplementationOnce(() => admission.promise)
      .mockResolvedValue(undefined);
    const window = render(<Window reviewOpen />);
    await waitFor(() =>
      expect(bridge.setShellOverlay).toHaveBeenCalledTimes(1),
    );
    window.rerender(<Window reviewOpen={false} />);
    window.rerender(<Window reviewOpen />);
    await act(async () => admission.resolve());
    await waitFor(() =>
      expect(bridge.setShellOverlay).toHaveBeenCalledTimes(2),
    );
    expect(bridge.setShellOverlay.mock.calls).toEqual([[true], [true]]);
    window.unmount();
  });

  it("reasserts the current state on reconnect after a failed write", async () => {
    const admission = deferred();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    bridge.setShellOverlay
      .mockImplementationOnce(() => admission.promise)
      .mockResolvedValue(undefined);
    const window = render(<Window reviewOpen />);
    await waitFor(() =>
      expect(bridge.setShellOverlay).toHaveBeenCalledTimes(1),
    );
    await act(async () =>
      admission.reject(new Error("Admission disconnected")),
    );
    await act(async () => bridge.connected?.({ status: "connected" }));
    expect(bridge.setShellOverlay.mock.calls).toEqual([[true], [true]]);
    window.unmount();
  });
});
