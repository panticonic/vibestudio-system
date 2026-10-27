import type { FlattenedPanel, PanelTreeViewNode } from "../shell/hooks/PanelTreeContext";

/** A virtualized panel or pagination row. */
export type SidebarRow =
  | { kind: "panel"; item: FlattenedPanel }
  | { kind: "root-groups-more" }
  | {
      kind: "load-more";
      groupKey: string;
      parentSlotId: string | null;
      ownerUserId?: string | null;
      depth: number;
      remaining: number;
      loadedCount: number;
    };

/** Keep ownership-scoped pagination within one continuous panel tree. */
export function buildSidebarRows(
  flattenedItems: FlattenedPanel[],
  forest: Array<{
    owner: string;
    rootCount: number;
    rootLoadedCount?: number;
    rootsHaveMore?: boolean;
    rootPanels: PanelTreeViewNode[];
  }>
): SidebarRow[] {
  const populated = forest.filter((group) => group.rootPanels.length > 0);
  const itemById = new Map(flattenedItems.map((item) => [item.id, item]));
  const rows: SidebarRow[] = [];

  const appendGroup = (
    panels: PanelTreeViewNode[],
    totalCount: number,
    loadedCount: number,
    hasMore: boolean,
    groupKey: string,
    parentSlotId: string | null,
    ownerUserId: string | null | undefined,
    depth: number
  ) => {
    for (const panel of panels) {
      const item = itemById.get(panel.id);
      if (!item) continue;
      rows.push({ kind: "panel", item });
      if (!item.collapsed && panel.childCount > 0) {
        appendGroup(
          panel.children,
          panel.childCount,
          panel.childrenLoadedCount ?? panel.children.length,
          panel.childrenLoaded === false ||
            (panel.childrenHasMore ?? panel.children.length < panel.childCount),
          `children:${panel.id}`,
          panel.id,
          undefined,
          depth + 1
        );
      }
    }
    if (hasMore) {
      rows.push({
        kind: "load-more",
        groupKey,
        parentSlotId,
        ...(ownerUserId !== undefined ? { ownerUserId } : {}),
        depth,
        remaining: Math.max(0, totalCount - loadedCount),
        loadedCount,
      });
    }
  };

  for (const group of populated) {
    appendGroup(
      group.rootPanels,
      group.rootCount,
      group.rootLoadedCount ?? group.rootPanels.length,
      group.rootsHaveMore ?? group.rootPanels.length < group.rootCount,
      `roots:${group.owner}`,
      null,
      group.owner || null,
      0
    );
  }
  return rows;
}

// ============================================================================
// Sidebar Component
// ============================================================================
