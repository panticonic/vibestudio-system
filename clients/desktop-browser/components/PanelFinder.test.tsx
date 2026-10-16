// @vitest-environment jsdom
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PanelTreeSearchPage } from "@vibestudio/shared/panel/treeIndex";
import { PanelFinder } from "./PanelFinder";

const workspaces = [
  {
    workspaceId: "personal",
    name: "Personal",
    privateRole: "personal" as const,
    lastOpened: 0,
    running: true,
    pendingApprovalCount: 0,
  },
];

function page(title: string, cursor: string | null): PanelTreeSearchPage {
  return {
    revision: 1,
    hits: [
      {
        node: {
          slotId: title,
          title,
        } as PanelTreeSearchPage["hits"][number]["node"],
        ancestors: [
          {
            title: "A long parent path",
          } as PanelTreeSearchPage["hits"][number]["node"],
        ],
      },
    ],
    nextCursor: cursor,
  };
}

describe("PanelFinder", () => {
  it("ignores an older search that finishes after the query changes", async () => {
    let finishOld!: (page: PanelTreeSearchPage) => void;
    const search = vi.fn((_workspaceId: string, query: string) =>
      query === "old"
        ? new Promise<PanelTreeSearchPage>((resolve) => {
            finishOld = resolve;
          })
        : Promise.resolve(page("Current result", null)),
    );
    const view = render(
      <PanelFinder
        workspaces={workspaces}
        query="old"
        onQueryChange={vi.fn()}
        search={search}
        onSelect={vi.fn()}
      />,
    );
    try {
      await waitFor(() => expect(finishOld).toBeDefined());
      view.rerender(
        <PanelFinder
          workspaces={workspaces}
          query="current"
          onQueryChange={vi.fn()}
          search={search}
          onSelect={vi.fn()}
        />,
      );
      await screen.findByRole("button", { name: /Current result/ });
      await act(async () => finishOld(page("Old result", null)));
      expect(screen.queryByRole("button", { name: /Old result/ })).toBeNull();
    } finally {
      view.unmount();
    }
  });
  it("shows the matching title before its path and loads another page", async () => {
    const search = vi.fn(
      async (_workspaceId: string, _query: string, cursor?: string) =>
        cursor ? page("Second panel", null) : page("First panel", "next"),
    );
    const onSelect = vi.fn();
    const view = render(
      <PanelFinder
        workspaces={workspaces}
        query="panel"
        onQueryChange={vi.fn()}
        search={search}
        onSelect={onSelect}
      />,
    );
    try {
      const first = await screen.findByRole("button", { name: /First panel/ });
      expect(first.firstElementChild?.textContent).toBe("First panel");
      expect(first.lastElementChild?.textContent).toBe(
        "Personal › A long parent path",
      );
      fireEvent.click(
        screen.getByRole("button", { name: "Load more matches" }),
      );
      await screen.findByRole("button", { name: /Second panel/ });
      expect(search).toHaveBeenLastCalledWith("personal", "panel", "next");
      fireEvent.click(first);
      expect(onSelect).toHaveBeenCalledWith("personal", "First panel");
    } finally {
      view.unmount();
    }
  });

  it("distinguishes no matches from an unavailable workspace", async () => {
    const search = vi.fn(async () => ({
      revision: 1,
      hits: [],
      nextCursor: null,
    }));
    const view = render(
      <PanelFinder
        workspaces={workspaces}
        query="absent"
        onQueryChange={vi.fn()}
        search={search}
        onSelect={vi.fn()}
      />,
    );
    try {
      await waitFor(() =>
        expect(screen.getByRole("status").textContent).toContain(
          "No matching panels",
        ),
      );
      const failing = vi.fn(async () => {
        throw new Error("Offline");
      });
      view.rerender(
        <PanelFinder
          workspaces={workspaces}
          query="another"
          onQueryChange={vi.fn()}
          search={failing}
          onSelect={vi.fn()}
        />,
      );
      expect((await screen.findByRole("alert")).textContent).toContain(
        "Offline",
      );
    } finally {
      view.unmount();
    }
  });
});
