// One per-device arrangement owns panel positions, focus, and viewport position.
// Clicking an open panel focuses it in place. Hidden-panel navigation replaces
// the focused pane; explicit beside/below or drag actions change the arrangement.
// Overflow reveals the focused column with the smallest shift, then holds that
// window steady until navigation, resizing, or layout edits require a change.

export interface PanelLayout {
  columns: LayoutColumn[]; // left-to-right
  focusedPaneId: string | null; // layout-level focus (not DOM focus)
  /** Leftmost viewport column. Focus inside this window never scrolls it. */
  viewportColumnId?: string;
}

export interface LayoutColumn {
  id: string; // stable pane-position id, e.g. "col-a3f2"
  widthFr: number; // proportional width (fr units), normalized
  panes: LayoutPane[]; // top-to-bottom
}

export interface LayoutPane {
  id: string; // stable, e.g. "pane-9c1d" — is the *position* id
  heightFr: number; // proportional height within the column
  panelId: string; // content currently shown here
  /**
   * Per-device minimum width override for the current panel presentation.
   * Cleared whenever ordinary navigation replaces the pane's content.
   */
  minWidthOverride?: number;
}

export type { PanelPlacementHint } from "@vibestudio/shared/types";

// Per-device persistence schema (§3.3). Treated as untrusted on restore.
export interface PersistedLayout {
  version: 1;
  workspaceId: string;
  layout: PanelLayout; // panelIds validated against tree on restore
  updatedAt: string;
}

/**
 * Where a dragged panel is being placed, expressed in layout coordinates rather
 * than pixels or indices. Ids, not indices: a drop that moves an existing pane
 * first detaches it, which can delete a column and shift every index after it.
 */
export type PaneEdge = "left" | "right" | "top" | "bottom";

export type LayoutDropTarget =
  /** A new column immediately after this one; null means before the first. */
  | { kind: "new-column"; afterColumnId: string | null }
  /** Split this pane: left/right open a new column, top/bottom stack in place. */
  | { kind: "pane-edge"; paneId: string; edge: PaneEdge }
  /** Take over this pane — swap with it when the drag came from another pane. */
  | { kind: "pane-center"; paneId: string };

export const MIN_COLUMN_WIDTH = 575;
// The default preferred size must satisfy the default readability minimum.
export const PREFERRED_COLUMN_WIDTH = MIN_COLUMN_WIDTH;
export const MIN_PANE_HEIGHT = 160;
export const COLUMN_DIVIDER_WIDTH = 7;
/** Permanent pane titlebar, including breadcrumbs and pane actions. */
export const PANE_TITLEBAR_HEIGHT = 36;
export const PANE_DIVIDER_HEIGHT = COLUMN_DIVIDER_WIDTH;
export const PANE_VERTICAL_CHROME_HEIGHT =
  PANE_TITLEBAR_HEIGHT + PANE_DIVIDER_HEIGHT;

function mintId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

export function mintPaneId(): string {
  return mintId("pane");
}

export function mintColumnId(): string {
  return mintId("col");
}

export function nativeSlotIdForPane(paneId: string): string {
  return `panel-stack:${paneId}`;
}
