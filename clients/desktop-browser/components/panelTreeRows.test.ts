import { describe, expect, it } from "vitest";
import { buildSidebarRows } from "./panelTreeRows";
import type {
  FlattenedPanel,
  PanelTreeViewNode,
} from "../shell/hooks/PanelTreeContext";

const child: PanelTreeViewNode = {
  id: "child",
  title: "Child",
  owner: null,
  parentId: "root",
  childCount: 0,
  children: [],
  childrenLoaded: true,
  childrenHasMore: false,
  selectedChildId: null,
};
const root: PanelTreeViewNode = {
  ...child,
  id: "root",
  title: "Root",
  parentId: null,
  childCount: 1,
  children: [child],
};
const item = (node: PanelTreeViewNode, collapsed = false): FlattenedPanel => ({
  id: node.id,
  parentId: node.parentId,
  depth: node.parentId ? 1 : 0,
  index: 0,
  collapsed,
  panel: {
    id: node.id,
    title: node.title,
    childCount: node.childCount,
    position: 0,
  },
});
const forest = (node: PanelTreeViewNode) => [
  { owner: "", rootCount: 1, rootPanels: [node] },
];

describe("shared sidebar tree rows", () => {
  it("keeps descendants in depth-first rail order while the wide tree can remain folded", () => {
    const wide = buildSidebarRows([item(root, true)], forest(root));
    expect(
      wide.map((row) => (row.kind === "panel" ? row.item.id : row.kind)),
    ).toEqual(["root"]);
    const rail = buildSidebarRows([item(root), item(child)], forest(root));
    expect(
      rail.map((row) => (row.kind === "panel" ? row.item.id : row.kind)),
    ).toEqual(["root", "child"]);
  });
  it("exposes an unopened child page so scrolling the rail can reach the entire tree", () => {
    const unloaded = {
      ...root,
      children: [],
      childrenLoaded: false,
      childrenHasMore: false,
    };
    expect(buildSidebarRows([item(unloaded)], forest(unloaded))).toMatchObject([
      { kind: "panel", item: { id: "root" } },
      { kind: "load-more", parentSlotId: "root", remaining: 1, loadedCount: 0 },
    ]);
  });
});
