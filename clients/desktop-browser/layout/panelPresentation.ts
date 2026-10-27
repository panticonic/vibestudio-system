import { paneForPanel } from "./placementEngine";
import type { LayoutAction } from "./placementEngine";
import type { EventPayloads } from "@vibestudio/shared/events";
import type { PanelLayout } from "./types";

/** Translate the authoritative creation fact into one device-local layout action. */
export function panelCreatedLayoutAction(
  created: EventPayloads["panel-created"],
): LayoutAction | null {
  if (!created.focus) return null;
  if (created.parentId) {
    return {
      type: "open-child",
      panelId: created.panelId,
      parentId: created.parentId,
      ...(created.placement ? { hint: created.placement } : {}),
    };
  }
  if (created.placement) {
    return {
      type: "present-panel",
      panelId: created.panelId,
      hint: created.placement,
    };
  }
  return { type: "show-panel", panelId: created.panelId };
}

/**
 * Resolve the context-menu "Open in New Column" command without duplicating
 * layout policy in the tree, breadcrumbs, or pane chrome.
 */
export function openInNewColumnAction(
  layout: PanelLayout,
  panelId: string,
  anchorPanelId?: string,
): LayoutAction {
  const existing = paneForPanel(layout, panelId);
  if (existing) {
    return existing.column.panes.length > 1
      ? { type: "move-pane-to-new-column", paneId: existing.pane.id }
      : { type: "focus-pane", paneId: existing.pane.id };
  }
  const anchorPaneId = anchorPanelId
    ? (paneForPanel(layout, anchorPanelId)?.pane.id ?? layout.focusedPaneId)
    : layout.focusedPaneId;
  if (anchorPaneId) {
    return {
      type: "open-beside",
      panelId,
      anchorPaneId,
    };
  }
  return { type: "show-panel", panelId };
}

/** Descending into a panel keeps its visible ancestor beside it when space allows.
 * Unrelated navigation still retargets the chosen pane; open panels focus in place.
 */
export function panelNavigationAction(
  layout: PanelLayout,
  panelId: string,
  parentMap: ReadonlyMap<string, string | null>,
  anchorPanelId = layout.columns
    .flatMap((column) => column.panes)
    .find((pane) => pane.id === layout.focusedPaneId)?.panelId,
): LayoutAction {
  if (paneForPanel(layout, panelId)) return { type: "show-panel", panelId };
  const visited = new Set<string>();
  let ancestor = parentMap.get(panelId);
  while (ancestor && !visited.has(ancestor)) {
    if (ancestor === anchorPanelId)
      return {
        type: "present-panel",
        panelId,
        anchorPanelId,
        hint: { disposition: "side-if-room" },
      };
    visited.add(ancestor);
    ancestor = parentMap.get(ancestor);
  }
  return { type: "show-panel", panelId };
}
