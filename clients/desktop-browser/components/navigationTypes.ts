import type {
  PanelSummary,
  PanelAncestor,
  DescendantSiblingGroup,
} from "@vibestudio/shared/types";

export type NavigationMode = "stack" | "tree";

// Re-export for convenience
export type { PanelSummary, PanelAncestor, DescendantSiblingGroup };

/**
 * Lazy title navigation data using PanelSummary.
 * Ancestors and the current panel for one pane.
 */
export interface LazyTitleNavigationData {
  ancestors: PanelAncestor[];
  current: PanelSummary;
}

/**
 * Lazy status navigation data using descendant sibling groups.
 * Used for breadcrumb bar showing selected descendants with siblings.
 */
export interface LazyStatusNavigationData {
  descendantGroups: DescendantSiblingGroup[];
  visiblePanelId: string;
}
