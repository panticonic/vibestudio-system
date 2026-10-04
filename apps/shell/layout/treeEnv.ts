// Adapts the shell's panel-forest maps to the placement engine's LayoutEnv
// tree queries (§4). All walks stay inside one owner's tree by construction —
// parent/child links never cross owner boundaries (§4.8).

import type { PanelTreeViewNode } from "../shell/hooks/PanelTreeContext";
import { MIN_COLUMN_WIDTH } from "./types";
import type { PanelPlacementHint } from "./types";

export interface TreeMaps {
  panelMap: Map<string, PanelTreeViewNode>;
  parentMap: Map<string, string | null>;
}

/**
 * A query-first projection can lag a presentation event. Treat absence as a
 * deletion only after the panel has appeared in a preceding projection.
 */
export function observedPanelDeletions(
  visiblePanelIds: readonly string[],
  previous: Pick<TreeMaps, "panelMap">,
  current: Pick<TreeMaps, "panelMap">
): string[] {
  return visiblePanelIds.filter(
    (panelId) => previous.panelMap.has(panelId) && !current.panelMap.has(panelId)
  );
}

/** The resolved placement hint the server persists on PanelSnapshot (W4). */
export function placementHintOf(
  panel: PanelTreeViewNode | undefined
): PanelPlacementHint | undefined {
  return panel?.placement;
}

export function minWidthOfPanel(maps: TreeMaps, panelId: string): number {
  const hint = placementHintOf(maps.panelMap.get(panelId));
  const min = hint?.minWidth;
  return typeof min === "number" && Number.isFinite(min) && min > 0 ? min : MIN_COLUMN_WIDTH;
}

/**
 * Fallback candidates for a panel about to disappear from the tree, computed
 * from the OLD topology (§4.5): parent first, then siblings, then further
 * ancestors — never crossing an owner boundary (walks can't).
 */
export function fallbackCandidatesFor(maps: TreeMaps, panelId: string): string[] {
  const candidates: string[] = [];
  const parentId = maps.parentMap.get(panelId) ?? null;
  if (parentId) candidates.push(parentId);
  const siblings = parentId ? (maps.panelMap.get(parentId)?.children ?? []) : [];
  for (const sibling of siblings) {
    if (sibling.id !== panelId) candidates.push(sibling.id);
  }
  let ancestorId = parentId ? (maps.parentMap.get(parentId) ?? null) : null;
  while (ancestorId) {
    candidates.push(ancestorId);
    ancestorId = maps.parentMap.get(ancestorId) ?? null;
  }
  return candidates;
}
