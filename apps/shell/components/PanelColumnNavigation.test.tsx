// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PanelColumnNavigation } from "./PanelColumnNavigation";
import type { PanelLayout } from "../layout/types";

afterEach(cleanup);

const layout: PanelLayout = {
  columns: ["A", "B", "C", "D"].map((panelId) => ({
    id: panelId,
    widthFr: 1,
    panes: [{ id: `pane-${panelId}`, panelId, heightFr: 1 }],
  })),
  focusedPaneId: "pane-C",
};

describe("PanelColumnNavigation", () => {
  it("shows the window and reveals the nearest parked column in either direction", () => {
    const reveal = vi.fn();
    const { getByRole, getByText } = render(
      <PanelColumnNavigation
        layout={layout}
        residentColumnIds={["B", "C"]}
        titleOf={(id) => `Panel ${id}`}
        onRevealColumn={reveal}
      />
    );
    expect(getByText("Columns 2–3 of 4")).toBeTruthy();
    const previous = getByRole("button", { name: "Show previous panel column" });
    const next = getByRole("button", { name: "Show next panel column" });
    expect(previous.getAttribute("title")).toBe("Show Panel A");
    expect(next.getAttribute("title")).toBe("Show Panel D");
    fireEvent.click(previous);
    fireEvent.click(next);
    expect(reveal.mock.calls).toEqual([["A"], ["D"]]);
  });

  it("disables navigation at the edge and disappears when every column fits", () => {
    const props = { layout, titleOf: (id: string) => id, onRevealColumn: vi.fn() };
    const { getByRole, queryByRole, rerender } = render(
      <PanelColumnNavigation {...props} residentColumnIds={["A", "B"]} />
    );
    expect(
      getByRole("button", { name: "Show previous panel column" }).hasAttribute("disabled")
    ).toBe(true);
    rerender(<PanelColumnNavigation {...props} residentColumnIds={["C", "D"]} />);
    expect(getByRole("button", { name: "Show next panel column" }).hasAttribute("disabled")).toBe(
      true
    );
    rerender(<PanelColumnNavigation {...props} residentColumnIds={["A", "B", "C", "D"]} />);
    expect(queryByRole("navigation")).toBeNull();
  });
});
