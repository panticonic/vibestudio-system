import {
  applyLayoutAction,
  computeViewport,
  type LayoutEnv,
} from "./placementEngine";
import { MIN_COLUMN_WIDTH, PANE_VERTICAL_CHROME_HEIGHT } from "./types";
import { describe, expect, it } from "vitest";
import {
  openInNewColumnAction,
  panelCreatedLayoutAction,
  panelNavigationAction,
} from "./panelPresentation";
import type { PanelLayout } from "./types";

describe("openInNewColumnAction", () => {
  it("opens a hidden tree or breadcrumb panel beside the focused pane", () => {
    const layout: PanelLayout = {
      columns: [
        {
          id: "column-a",
          widthFr: 1,
          panes: [{ id: "pane-a", heightFr: 1, panelId: "panel-a" }],
        },
      ],
      focusedPaneId: "pane-a",
    };

    expect(openInNewColumnAction(layout, "panel-b")).toEqual({
      type: "open-beside",
      panelId: "panel-b",
      anchorPaneId: "pane-a",
    });
  });

  it("opens a child beside the context-menu target even when another pane is focused", () => {
    const layout: PanelLayout = {
      columns: [
        {
          id: "column-a",
          widthFr: 1,
          panes: [{ id: "pane-a", heightFr: 1, panelId: "panel-a" }],
        },
        {
          id: "column-b",
          widthFr: 1,
          panes: [{ id: "pane-b", heightFr: 1, panelId: "panel-b" }],
        },
      ],
      focusedPaneId: "pane-a",
    };

    expect(openInNewColumnAction(layout, "panel-child", "panel-b")).toEqual({
      type: "open-beside",
      panelId: "panel-child",
      anchorPaneId: "pane-b",
    });
  });

  it("moves a visible stacked pane into its own column", () => {
    const layout: PanelLayout = {
      columns: [
        {
          id: "column-a",
          widthFr: 1,
          panes: [
            { id: "pane-a", heightFr: 1, panelId: "panel-a" },
            { id: "pane-b", heightFr: 1, panelId: "panel-b" },
          ],
        },
      ],
      focusedPaneId: "pane-a",
    };

    expect(openInNewColumnAction(layout, "panel-b")).toEqual({
      type: "move-pane-to-new-column",
      paneId: "pane-b",
    });
  });

  it("focuses a panel that is already alone in a column", () => {
    const layout: PanelLayout = {
      columns: [
        {
          id: "column-a",
          widthFr: 1,
          panes: [{ id: "pane-a", heightFr: 1, panelId: "panel-a" }],
        },
      ],
      focusedPaneId: null,
    };

    expect(openInNewColumnAction(layout, "panel-a")).toEqual({
      type: "focus-pane",
      paneId: "pane-a",
    });
  });
});

describe("panelCreatedLayoutAction", () => {
  it("opens a focused child relative to its authoritative parent", () => {
    expect(
      panelCreatedLayoutAction({
        panelId: "panel-child",
        parentId: "panel-parent",
        focus: true,
        placement: { disposition: "side", minWidth: 480 },
      }),
    ).toEqual({
      type: "open-child",
      panelId: "panel-child",
      parentId: "panel-parent",
      hint: { disposition: "side", minWidth: 480 },
    });
  });

  it("shows a focused root and ignores an intentional background creation", () => {
    expect(
      panelCreatedLayoutAction({
        panelId: "panel-root",
        parentId: null,
        focus: true,
      }),
    ).toEqual({
      type: "show-panel",
      panelId: "panel-root",
    });
    expect(
      panelCreatedLayoutAction({
        panelId: "panel-background",
        parentId: "panel-parent",
        focus: false,
      }),
    ).toBeNull();
  });

  it("honors an explicit placement hint for a focused root panel", () => {
    expect(
      panelCreatedLayoutAction({
        panelId: "panel-new",
        parentId: null,
        focus: true,
        placement: { disposition: "side-if-room" },
      }),
    ).toEqual({
      type: "present-panel",
      panelId: "panel-new",
      hint: { disposition: "side-if-room" },
    });
  });
});

describe("panel navigation placement", () => {
  const layout: PanelLayout = {
    columns: [
      {
        id: "parent-column",
        widthFr: 1,
        panes: [{ id: "parent-pane", panelId: "parent", heightFr: 1 }],
      },
    ],
    focusedPaneId: "parent-pane",
  };
  const parents = new Map([
    ["child", "parent"],
    ["grandchild", "child"],
    ["sibling", "parent"],
  ]);
  const env = (width: number): LayoutEnv => ({
    viewportWidth: width,
    viewportHeight: 800,
    paneChromeHeight: PANE_VERTICAL_CHROME_HEIGHT,
    minWidthOf: () => MIN_COLUMN_WIDTH,
    firstRootPanelId: () => "parent",
  });

  it.each(["child", "grandchild"])(
    "keeps the parent beside a selected %s when both fit",
    (panelId) => {
      const next = applyLayoutAction(
        layout,
        panelNavigationAction(layout, panelId, parents),
        env(1600),
      );
      expect(
        next.columns.map((column) => column.panes.map((pane) => pane.panelId)),
      ).toEqual([["parent"], [panelId]]);
      expect(computeViewport(next, env(1600)).residentColumnIds).toHaveLength(
        2,
      );
    },
  );

  it("reuses the chosen pane when there is not room beside it", () => {
    const next = applyLayoutAction(
      layout,
      panelNavigationAction(layout, "child", parents),
      env(900),
    );
    expect(next.columns).toHaveLength(1);
    expect(next.columns[0]?.panes[0]).toMatchObject({
      id: "parent-pane",
      panelId: "child",
    });
  });

  it("replaces a selected sibling without losing its parent's pane", () => {
    const split = applyLayoutAction(
      layout,
      panelNavigationAction(layout, "child", parents),
      env(1600),
    );
    const next = applyLayoutAction(
      split,
      panelNavigationAction(split, "sibling", parents),
      env(1600),
    );
    expect(
      next.columns.map((column) => column.panes.map((pane) => pane.panelId)),
    ).toEqual([["parent"], ["sibling"]]);
  });

  it("focuses an already open child without creating another column", () => {
    const split = applyLayoutAction(
      layout,
      panelNavigationAction(layout, "child", parents),
      env(1600),
    );
    const focusedParent = applyLayoutAction(
      split,
      { type: "focus-pane", paneId: "parent-pane" },
      env(1600),
    );
    const next = applyLayoutAction(
      focusedParent,
      panelNavigationAction(focusedParent, "child", parents),
      env(1600),
    );
    expect(next.columns).toEqual(split.columns);
    expect(next.focusedPaneId).toBe(split.focusedPaneId);
  });
});
