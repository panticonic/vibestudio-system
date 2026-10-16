import { describe, expect, it, vi } from "vitest";
import {
  createWorkspaceModel,
  workspaceEntries,
  workspaceListNotice,
  type WorkspacePort,
} from "./index.js";

const port = (overrides: Partial<WorkspacePort> = {}): WorkspacePort => ({
  list: async () => [
    { id: "a", name: "Alpha" },
    { id: "b", name: "Beta" },
    { id: "c", name: "Gamma" },
  ],
  select: vi.fn(async () => undefined),
  ...overrides,
});

describe("workspace model", () => {
  it("loads, marks the current workspace, keeps the host's order, and filters by query", async () => {
    const model = createWorkspaceModel(port(), "b");
    expect(workspaceListNotice(model.getSnapshot())).toBe("Loading workspaces…");
    await model.load();
    expect(workspaceEntries(model.getSnapshot()).map((entry) => [entry.id, entry.current])).toEqual([
      ["a", false],
      ["b", true],
      ["c", false],
    ]);
    model.setQuery("gam");
    expect(workspaceEntries(model.getSnapshot()).map((entry) => entry.id)).toEqual(["c"]);
    model.setQuery("zzz");
    expect(workspaceListNotice(model.getSnapshot())).toBe("No workspace matches.");
  });

  it("lets a surface bring its own ranking", async () => {
    const model = createWorkspaceModel(port(), "a");
    await model.load();
    model.setQuery("ma");
    const rank = (entries: Array<{ id: string }>, query: string) =>
      entries.filter((entry) => entry.id !== "b" && query.length > 0) as never;
    expect(workspaceEntries(model.getSnapshot(), rank).map((entry) => entry.id)).toEqual(["a", "c"]);
  });

  it("shows the current workspace alone, and says so when the host lists none", async () => {
    const model = createWorkspaceModel(port({ list: async () => [{ id: "a", name: "Alpha" }] }), "a");
    await model.load();
    expect(workspaceListNotice(model.getSnapshot())).toBeNull();
    expect(workspaceEntries(model.getSnapshot())).toHaveLength(1);
    const empty = createWorkspaceModel(port({ list: async () => [] }), "a");
    await empty.load();
    expect(workspaceListNotice(empty.getSnapshot())).toBe("No other workspaces.");
  });

  it("keeps and rethrows a list failure", async () => {
    const model = createWorkspaceModel(
      port({
        list: async () => {
          throw new Error("hub unreachable");
        },
      }),
      "a"
    );
    await expect(model.load()).rejects.toThrow("hub unreachable");
    expect(workspaceListNotice(model.getSnapshot())).toBe("Could not list workspaces: hub unreachable");
  });

  it("does not switch to the current workspace and records a failed switch without moving", async () => {
    const select = vi.fn(async (id: string) => {
      if (id === "c") throw new Error("denied");
    });
    const model = createWorkspaceModel(port({ select }), "a");
    await model.switchTo("a");
    expect(select).not.toHaveBeenCalled();
    await model.switchTo("b");
    expect(model.getSnapshot()).toMatchObject({ currentId: "b", switchingTo: null });
    await expect(model.switchTo("c")).rejects.toThrow("denied");
    expect(model.getSnapshot()).toMatchObject({ currentId: "b", switchingTo: null });
    expect(String(model.getSnapshot().switchError)).toContain("denied");
  });
});
