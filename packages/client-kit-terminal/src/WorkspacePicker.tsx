import React from "react";
import { Text } from "ink";
import {
  workspaceEntries,
  workspaceListNotice,
  type WorkspaceEntry,
  type WorkspaceModelState,
} from "@workspace/workspace-core";
import { ListOverlay, type ListItem, type ListMatch } from "./ListOverlay.js";

/** A workspace entry with the ranking's highlight, when the surface ranks by fuzzy match. */
export type RankedWorkspaceEntry = WorkspaceEntry & { match?: ListMatch };

/** A surface's own ranking of the entries by the typed query (the terminal's fuzzy match). */
export type WorkspaceRank = (entries: WorkspaceEntry[], query: string) => RankedWorkspaceEntry[];

/** The picker's rows: the workspaces in the host's order (or the surface's ranking), the current one hinted. */
export function workspacePickerItems(state: WorkspaceModelState, rank: WorkspaceRank): ListItem[] {
  return workspaceEntries(state, rank).map((entry) => ({
    key: entry.id,
    label: entry.name,
    ...(entry.current ? { hint: "current" } : {}),
    ...(entry.match ? { match: entry.match } : {}),
  }));
}

/** Switch workspace: list, filter and pick, over `workspace-core`. */
export function WorkspacePicker({
  state,
  items,
  selected,
  width,
  height,
  rank,
}: {
  state: WorkspaceModelState;
  items: ListItem[];
  selected: number;
  width: number;
  height: number;
  rank: WorkspaceRank;
}): React.ReactElement {
  const notice = workspaceListNotice(state, rank);
  return (
    <ListOverlay
      title="Switch workspace"
      query={state.query}
      placeholder="type to filter"
      items={items}
      selected={selected}
      width={width}
      height={height}
      empty={<Text dimColor>{notice ?? ""}</Text>}
      footer="↑↓ choose · Enter switch · Esc close"
    />
  );
}
