// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Theme } from "@radix-ui/themes";
import type { ReactNode } from "react";
import { PaneView } from "./PaneView";

const drag = vi.hoisted(() => ({ beginPaneDrag: vi.fn(), source: null }));
vi.mock("../shell/hooks/LayoutDragContext", () => ({
  useLayoutDrag: () => drag,
}));
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
        titleBar={<button>Mail breadcrumb</button>}
        title="Mail"
        focused={false}
        resident
        layoutEpoch={1}
        unresponsive={false}
        onDismissUnresponsive={vi.fn()}
        onFocusPane={focus}
        onClosePane={vi.fn()}
        onMovePane={vi.fn()}
      />,
      { wrapper },
    );
    const button = getByRole("button", { name: "Mail breadcrumb" });
    fireEvent.pointerDown(button);
    fireEvent.click(button);
    expect(focus).toHaveBeenCalledWith("pane-a");
    expect(drag.beginPaneDrag).not.toHaveBeenCalled();
    expect(getByRole("button", { name: "Close pane" }).tabIndex).toBe(0);
  });

  it("moves through the grip without a post-drag click focusing its former occupant", () => {
    const focus = vi.fn();
    const move = vi.fn();
    const { getByRole } = render(
      <PaneView
        pane={{ id: "pane-a", panelId: "a", heightFr: 1 }}
        titleBar={<button>Mail breadcrumb</button>}
        title="Mail"
        focused={false}
        resident
        layoutEpoch={1}
        unresponsive={false}
        onDismissUnresponsive={vi.fn()}
        onFocusPane={focus}
        onClosePane={vi.fn()}
        onMovePane={move}
      />,
      { wrapper },
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
  it("closes its own pane without hovering or starting a drag", () => {
    const close = vi.fn();
    const { getByRole, container } = render(
      <PaneView
        pane={{ id: "pane-b", panelId: "b", heightFr: 1 }}
        title="Notes"
        titleBar={<span>Notes</span>}
        focused={false}
        resident
        layoutEpoch={1}
        unresponsive={false}
        onDismissUnresponsive={vi.fn()}
        onFocusPane={vi.fn()}
        onClosePane={close}
        onMovePane={vi.fn()}
      />,
      { wrapper },
    );
    fireEvent.click(getByRole("button", { name: "Close pane" }));
    expect(close).toHaveBeenCalledWith("pane-b");
    expect(drag.beginPaneDrag).not.toHaveBeenCalled();
    expect(container.querySelector("[data-pane-rail]")).toBeNull();
  });
});
