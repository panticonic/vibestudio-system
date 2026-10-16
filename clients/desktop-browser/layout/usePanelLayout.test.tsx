// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { usePanelLayout } from "./usePanelLayout";
import { ShellWorkspaceClientContext } from "../shell/workspaceContext";
import type { ShellWorkspaceClient } from "../shell/workspaceClient";

vi.mock("../shell/client", () => ({}));
vi.mock("../shell/hooks/PanelTreeContext", () => {
  const root = { id: "shared-panel-id", snapshot: { source: "about/new" } };
  const panelMap = new Map(
    [root, ...["A", "B", "C", "D"].map((id) => ({ ...root, id }))].map((panel) => [panel.id, panel])
  );
  const parentMap = new Map();
  return {
    usePanelTree: () => ({
      panelMap,
      parentMap,
      initialized: true,
      refreshing: false,
    }),
    useRootPanels: () => ({ panels: [root], loading: false }),
  };
});

function owner(workspaceId: string, persisted: unknown = null) {
  const client = {
    events: {
      on: vi.fn(() => () => {}),
      subscribe: vi.fn(async () => {}),
      unsubscribe: vi.fn(async () => {}),
    },
    workspace: { getActive: vi.fn(async () => workspaceId) },
    panel: {
      getPanelLayout: vi.fn(async () => persisted),
      getFocusedPanelId: vi.fn(async () => null),
      setFocusedPanelId: vi.fn(async () => {}),
      savePanelLayout: vi.fn(async () => {}),
    },
  };
  return {
    client,
    wrapper: ({ children }: { children: ReactNode }) => (
      <ShellWorkspaceClientContext.Provider value={client as unknown as ShellWorkspaceClient}>
        {children}
      </ShellWorkspaceClientContext.Provider>
    ),
  };
}

describe("workspace-owned panel layout", () => {
  it("keeps a restored viewport stable through focus, resize, and saving", async () => {
    const columns = ["A", "B", "C", "D"].map((panelId) => ({
      id: `col-${panelId}`,
      widthFr: 1,
      panes: [{ id: `pane-${panelId}`, heightFr: 1, panelId }],
    }));
    const personal = owner("personal", {
      version: 1,
      layout: { columns, focusedPaneId: "pane-C", viewportColumnId: "col-B" },
    });
    const hook = renderHook(({ width }) => usePanelLayout(width, 600), {
      wrapper: personal.wrapper,
      initialProps: { width: 1200 },
    });
    try {
      await waitFor(() => expect(hook.result.current.restored).toBe(true));
      for (const panelId of ["B", "C", "B"]) {
        act(() => hook.result.current.dispatch({ type: "focus-pane", paneId: `pane-${panelId}` }));
        expect(hook.result.current.residentColumnIds).toEqual(["col-B", "col-C"]);
        expect(hook.result.current.layout.columns).toEqual(columns);
      }
      act(() => hook.result.current.dispatch({ type: "show-panel", panelId: "D" }));
      expect(hook.result.current.residentColumnIds).toEqual(["col-C", "col-D"]);
      hook.rerender({ width: 700 });
      await waitFor(() => expect(hook.result.current.layout.viewportColumnId).toBe("col-D"));
      expect(hook.result.current.residentColumnIds).toEqual(["col-D"]);
      hook.rerender({ width: 1800 });
      await waitFor(() => expect(hook.result.current.layout.viewportColumnId).toBe("col-B"));
      expect(hook.result.current.residentColumnIds).toEqual(["col-B", "col-C", "col-D"]);
      act(() => hook.result.current.dispatch({ type: "focus-pane", paneId: "pane-B" }));
      expect(hook.result.current.residentColumnIds).toEqual(["col-B", "col-C", "col-D"]);
      await waitFor(() =>
        expect(personal.client.panel.savePanelLayout).toHaveBeenCalledWith(
          expect.objectContaining({
            layout: expect.objectContaining({ viewportColumnId: "col-B", focusedPaneId: "pane-B" }),
          })
        )
      );
    } finally {
      hook.unmount();
    }
  });

  it("restores, focuses and saves identical panel IDs through their captured workspace owners", async () => {
    const personal = owner("personal");
    const system = owner("system");
    const a = renderHook(() => usePanelLayout(1024, 600), {
      wrapper: personal.wrapper,
    });
    const b = renderHook(() => usePanelLayout(1024, 600), {
      wrapper: system.wrapper,
    });
    try {
      await waitFor(() => {
        expect(a.result.current.restored).toBe(true);
        expect(b.result.current.restored).toBe(true);
      });
      for (const { client } of [personal, system]) {
        expect(client.panel.getPanelLayout).toHaveBeenCalledTimes(1);
        expect(client.panel.setFocusedPanelId).toHaveBeenCalledWith("shared-panel-id");
      }
      act(() => a.result.current.dispatch({ type: "resize-columns", columnFrs: [2] }));
      await waitFor(() =>
        expect(personal.client.panel.savePanelLayout).toHaveBeenCalledWith(
          expect.objectContaining({ workspaceId: "personal" })
        )
      );
      expect(system.client.panel.savePanelLayout).not.toHaveBeenCalled();
    } finally {
      a.unmount();
      b.unmount();
    }
  });
});
