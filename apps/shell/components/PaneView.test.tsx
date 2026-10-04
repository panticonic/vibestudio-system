// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Theme } from "@radix-ui/themes";
import type { ReactNode } from "react";
import { PaneView } from "./PaneView";

const drag = vi.hoisted(() => ({ beginPaneDrag: vi.fn(), source: null }));
vi.mock("../shell/hooks/LayoutDragContext", () => ({ useLayoutDrag: () => drag }));
vi.mock("@workspace/react/responsive", () => ({ useTouchDevice: () => false }));
vi.mock("./PaneContent", () => ({ PaneContent: () => null }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function wrapper({ children }: { children: ReactNode }) {
  return <Theme>{children}</Theme>;
}

describe("PaneView placement controls", () => {
  it("focuses through the title without beginning a placement gesture", () => {
    const focus = vi.fn();
    const { getByRole } = render(
      <PaneView
        pane={{ id: "pane-a", panelId: "a", heightFr: 1 }}
        title="Mail"
        focused={false}
        showPaneFocus
        resident
        layoutEpoch={1}
        unresponsive={false}
        onDismissUnresponsive={vi.fn()}
        onFocusPane={focus}
        onClosePane={vi.fn()}
        onMovePane={vi.fn()}
      />,
      { wrapper }
    );
    const button = getByRole("button", { name: "Focus Mail" });
    fireEvent.pointerDown(button);
    fireEvent.click(button);
    expect(focus).toHaveBeenCalledWith("pane-a");
    expect(drag.beginPaneDrag).not.toHaveBeenCalled();
  });

  it("moves through the grip without a post-drag click focusing its former occupant", () => {
    const focus = vi.fn();
    const move = vi.fn();
    const { getByRole } = render(
      <PaneView
        pane={{ id: "pane-a", panelId: "a", heightFr: 1 }}
        title="Mail"
        focused={false}
        showPaneFocus
        resident
        layoutEpoch={1}
        unresponsive={false}
        onDismissUnresponsive={vi.fn()}
        onFocusPane={focus}
        onClosePane={vi.fn()}
        onMovePane={move}
      />,
      { wrapper }
    );
    const grip = getByRole("button", { name: "Move Mail" });
    fireEvent.pointerDown(grip);
    expect(drag.beginPaneDrag).toHaveBeenCalledWith(expect.anything(), {
      panelId: "a",
      title: "Mail",
      fromPaneId: "pane-a",
    });
    fireEvent.pointerUp(grip);
    fireEvent.click(grip);
    expect(focus).not.toHaveBeenCalled();
    fireEvent.keyDown(grip, { key: "ArrowRight" });
    expect(move).toHaveBeenCalledWith("pane-a", "right");
  });
});
