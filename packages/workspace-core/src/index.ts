import { createSnapshotStore, type SnapshotStore } from "@workspace/snapshot-store";

/** A workspace a paired device may select. */
export interface WorkspaceSummary {
  id: string;
  /** What a person calls it. */
  name: string;
}

/** What a host offers to list and switch workspaces. */
export interface WorkspacePort {
  /** The workspaces this device may select. */
  list(): Promise<readonly WorkspaceSummary[]>;
  /** Make `workspaceId` the selected workspace. Resolves once the host has accepted the switch. */
  select(workspaceId: string): Promise<void>;
}

export type WorkspaceListState =
  | { status: "loading"; workspaces: null }
  | { status: "ready"; workspaces: readonly WorkspaceSummary[] }
  | { status: "failed"; workspaces: null; error: unknown };

export interface WorkspaceModelState {
  list: WorkspaceListState;
  /** The filter the person typed. */
  query: string;
  /** The selected workspace's id. */
  currentId: string;
  /** A switch is in flight to this workspace. */
  switchingTo: string | null;
  /** The last switch's failure; cleared by the next attempt. */
  switchError: unknown;
}

export interface WorkspaceEntry extends WorkspaceSummary {
  current: boolean;
}

export interface WorkspaceModel extends SnapshotStore<WorkspaceModelState> {
  /** Read the list (again). Failure is kept in the state and rejected. */
  load(): Promise<void>;
  setQuery(query: string): void;
  /**
   * Switch to a workspace. Choosing the current one is not a switch and resolves
   * without calling the host. The host's failure is kept and rethrown.
   */
  switchTo(workspaceId: string): Promise<void>;
}

export function createWorkspaceModel(port: WorkspacePort, currentId: string): WorkspaceModel {
  const store = createSnapshotStore<WorkspaceModelState>({
    list: { status: "loading", workspaces: null },
    query: "",
    currentId,
    switchingTo: null,
    switchError: undefined,
  });
  return {
    getSnapshot: store.getSnapshot,
    subscribe: store.subscribe,
    async load() {
      try {
        const workspaces = await port.list();
        store.update((current) => ({ ...current, list: { status: "ready", workspaces } }));
      } catch (error) {
        store.update((current) => ({
          ...current,
          list: { status: "failed", workspaces: null, error },
        }));
        throw error;
      }
    },
    setQuery(query) {
      store.update((current) => (current.query === query ? current : { ...current, query }));
    },
    async switchTo(workspaceId) {
      if (workspaceId === store.getSnapshot().currentId) return;
      store.update((current) => ({ ...current, switchingTo: workspaceId, switchError: undefined }));
      try {
        await port.select(workspaceId);
        store.update((current) => ({ ...current, currentId: workspaceId, switchingTo: null }));
      } catch (error) {
        store.update((current) => ({ ...current, switchingTo: null, switchError: error }));
        throw error;
      }
    },
  };
}

/**
 * The entries to show, in the order the host listed them, the current one
 * marked. The query narrows them by case-insensitive substring of the name or
 * id, unless the surface brings its own ranking (the terminal's fuzzy match),
 * which then owns both the narrowing and the order.
 */
export function workspaceEntries(state: WorkspaceModelState): WorkspaceEntry[];
export function workspaceEntries<Ranked extends WorkspaceEntry>(
  state: WorkspaceModelState,
  rank: (entries: WorkspaceEntry[], query: string) => Ranked[]
): Ranked[];
export function workspaceEntries(
  state: WorkspaceModelState,
  rank?: (entries: WorkspaceEntry[], query: string) => WorkspaceEntry[]
): WorkspaceEntry[] {
  if (state.list.status !== "ready") return [];
  const entries = state.list.workspaces.map((workspace) => ({
    ...workspace,
    current: workspace.id === state.currentId,
  }));
  if (rank) return rank(entries, state.query);
  const needle = state.query.trim().toLowerCase();
  return needle === ""
    ? entries
    : entries.filter(
        (entry) =>
          entry.name.toLowerCase().includes(needle) || entry.id.toLowerCase().includes(needle)
      );
}

/** What to say where the list would be, or `null` when there are entries to show. */
export function workspaceListNotice(
  state: WorkspaceModelState,
  rank?: (entries: WorkspaceEntry[], query: string) => WorkspaceEntry[]
): string | null {
  if (state.list.status === "loading") return "Loading workspaces…";
  if (state.list.status === "failed") {
    const error = state.list.error;
    return `Could not list workspaces: ${error instanceof Error ? error.message : String(error)}`;
  }
  const entries = rank ? workspaceEntries(state, rank) : workspaceEntries(state);
  if (entries.length > 0) return null;
  return state.query.trim() !== "" ? "No workspace matches." : "No other workspaces.";
}
