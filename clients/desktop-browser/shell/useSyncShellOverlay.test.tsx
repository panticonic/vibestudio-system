// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSyncShellOverlay } from "./useSyncShellOverlay";

const setShellOverlayActive = vi.fn<(active: boolean) => void>();

function Window({ dialogOpen }: { dialogOpen: boolean }) {
  useSyncShellOverlay(dialogOpen);
  return null;
}

describe("native dialog visibility", () => {
  beforeEach(() => {
    setShellOverlayActive.mockReset();
    Object.assign(globalThis, {
      __vibestudioApp: { setShellOverlayActive },
    });
  });

  afterEach(() => {
    delete (globalThis as { __vibestudioApp?: unknown }).__vibestudioApp;
  });

  it("writes ordered compositor state directly through the desktop host", () => {
    const window = render(<Window dialogOpen={false} />);
    window.rerender(<Window dialogOpen />);
    window.rerender(<Window dialogOpen={false} />);

    expect(setShellOverlayActive.mock.calls).toEqual([
      [false],
      [true],
      [false],
    ]);
  });

  it("does not require a workspace client or reconnect event to hide panels", () => {
    render(<Window dialogOpen />);
    expect(setShellOverlayActive).toHaveBeenCalledWith(true);
  });
});
