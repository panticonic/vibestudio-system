import { useEffect, useRef, useState } from "react";
import { Cross2Icon, MagnifyingGlassIcon } from "@radix-ui/react-icons";
import type { HubWorkspaceEntry } from "@vibestudio/service-schemas/hubControl";
import {
  panelTreeSearchBreadcrumb,
  type PanelTreeSearchPage,
} from "@vibestudio/shared/panel/treeIndex";
import { workspaceLabel } from "../shell/workspaceLabel";

type Hit = { id: string; title: string; breadcrumb: string };
type Group = {
  hits: Hit[];
  cursor: string | null;
  loading: boolean;
  error: string | null;
};

function appendPage(previous: Group, page: PanelTreeSearchPage): Group {
  const seen = new Set(previous.hits.map((hit) => hit.id));
  const hits = page.hits
    .filter(({ node }) => !seen.has(node.slotId))
    .map((hit) => ({
      id: hit.node.slotId,
      title: hit.node.title,
      breadcrumb: panelTreeSearchBreadcrumb(hit),
    }));
  return {
    hits: [...previous.hits, ...hits],
    cursor: page.nextCursor,
    loading: false,
    error: null,
  };
}

export function PanelFinder({
  workspaces,
  query,
  onQueryChange,
  search,
  onSelect,
}: {
  workspaces: readonly HubWorkspaceEntry[];
  query: string;
  onQueryChange(query: string): void;
  search(
    workspaceId: string,
    query: string,
    cursor?: string,
  ): Promise<PanelTreeSearchPage>;
  onSelect(workspaceId: string, panelId: string): void;
}) {
  const [groups, setGroups] = useState<Record<string, Group>>({});
  const trimmed = query.trim();
  const activeQuery = useRef(trimmed);
  const searchGeneration = useRef(0);
  activeQuery.current = trimmed;
  useEffect(() => {
    searchGeneration.current += 1;
    if (!trimmed) {
      setGroups({});
      return;
    }
    const initial = Object.fromEntries(
      workspaces.map(({ workspaceId }) => [
        workspaceId,
        { hits: [], cursor: null, loading: true, error: null },
      ]),
    ) as Record<string, Group>;
    setGroups(initial);
    let cancelled = false;
    const timer = window.setTimeout(() => {
      let nextIndex = 0;
      const worker = async () => {
        while (!cancelled && nextIndex < workspaces.length) {
          const workspace = workspaces[nextIndex++];
          if (!workspace) break;
          const { workspaceId } = workspace;
          const initialGroup = initial[workspaceId];
          if (!initialGroup) continue;
          try {
            const page = await search(workspaceId, trimmed);
            if (!cancelled)
              setGroups((current) => ({
                ...current,
                [workspaceId]: appendPage(initialGroup, page),
              }));
          } catch (error) {
            if (!cancelled)
              setGroups((current) => ({
                ...current,
                [workspaceId]: {
                  ...initialGroup,
                  loading: false,
                  error: error instanceof Error ? error.message : String(error),
                },
              }));
          }
        }
      };
      void Promise.all(
        Array.from({ length: Math.min(3, workspaces.length) }, worker),
      );
    }, 150);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [trimmed, workspaces, search]);

  const loadMore = (workspaceId: string) => {
    const group = groups[workspaceId];
    if (!group?.cursor || group.loading) return;
    setGroups((current) => ({
      ...current,
      [workspaceId]: { ...group, loading: true },
    }));
    const requestedQuery = trimmed;
    const generation = searchGeneration.current;
    void search(workspaceId, requestedQuery, group.cursor)
      .then((page) => {
        if (
          activeQuery.current !== requestedQuery ||
          searchGeneration.current !== generation
        )
          return;
        setGroups((current) => ({
          ...current,
          [workspaceId]: appendPage(current[workspaceId] ?? group, page),
        }));
      })
      .catch((error: unknown) => {
        if (
          activeQuery.current !== requestedQuery ||
          searchGeneration.current !== generation
        )
          return;
        setGroups((current) => ({
          ...current,
          [workspaceId]: {
            ...(current[workspaceId] ?? group),
            loading: false,
            error: error instanceof Error ? error.message : String(error),
          },
        }));
      });
  };
  const loading = workspaces.some(
    (workspace) => groups[workspace.workspaceId]?.loading,
  );
  const hasHits = workspaces.some(
    (workspace) => (groups[workspace.workspaceId]?.hits.length ?? 0) > 0,
  );
  const hasErrors = workspaces.some((workspace) =>
    Boolean(groups[workspace.workspaceId]?.error),
  );

  return (
    <>
      <div className="panel-finder-field">
        <MagnifyingGlassIcon aria-hidden="true" />
        <input
          type="search"
          aria-label="Find panels"
          placeholder="Find panels"
          value={query}
          onChange={(event) => onQueryChange(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") onQueryChange("");
          }}
        />
        {query && (
          <button
            type="button"
            aria-label="Clear panel search"
            onClick={() => onQueryChange("")}
          >
            <Cross2Icon />
          </button>
        )}
      </div>
      {trimmed && (
        <div
          className="panel-finder-results"
          role="region"
          aria-label="Panel search results"
        >
          {workspaces.map((workspace) => {
            const group = groups[workspace.workspaceId];
            if (!group || (!group.hits.length && !group.error)) return null;
            return (
              <section
                key={workspace.workspaceId}
                className="panel-finder-group"
              >
                <h2>{workspaceLabel(workspace)}</h2>
                {group.hits.map((hit) => (
                  <button
                    type="button"
                    className="panel-finder-result"
                    key={hit.id}
                    onClick={() => onSelect(workspace.workspaceId, hit.id)}
                  >
                    <span className="panel-finder-title" title={hit.title}>
                      {hit.title}
                    </span>
                    <span className="panel-finder-path" title={hit.breadcrumb}>
                      {[workspaceLabel(workspace), hit.breadcrumb]
                        .filter(Boolean)
                        .join(" › ")}
                    </span>
                  </button>
                ))}
                {group.error && (
                  <p role="alert">
                    Couldn’t search this workspace: {group.error}
                  </p>
                )}
                {group.cursor && (
                  <button
                    type="button"
                    className="panel-finder-more"
                    disabled={group.loading}
                    onClick={() => loadMore(workspace.workspaceId)}
                  >
                    {group.loading ? "Loading…" : "Load more matches"}
                  </button>
                )}
              </section>
            );
          })}
          {!hasHits && !hasErrors && (
            <p className="panel-finder-status" role="status">
              {loading
                ? "Searching panels…"
                : "No matching panels. Try a different search."}
            </p>
          )}
          {hasHits && loading && (
            <p className="panel-finder-status" role="status">
              Searching other workspaces…
            </p>
          )}
        </div>
      )}
    </>
  );
}
