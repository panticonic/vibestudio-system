import { describe, expect, it, vi } from "vitest";
import { buildClientMenu, runMenuAction, type MenuItem } from "./clientMenu";
import { localShellEvents } from "./localShellEvents";

function actionIds(items: readonly MenuItem[]): string[] {
  return items.flatMap((item) => [
    ...(item.id ? [item.id] : []),
    ...(item.submenu ? actionIds(item.submenu) : []),
  ]);
}

function everyItem(items: readonly MenuItem[]): MenuItem[] {
  return items.flatMap((item) => [item, ...(item.submenu ? everyItem(item.submenu) : [])]);
}

const context = () => ({
  panelHost: vi.fn(async () => undefined),
  clearBuildCache: vi.fn(async () => undefined),
  failed: vi.fn(),
});

describe("client menu", () => {
  for (const platform of ["mac", "other"] as const) {
    it(`gives every ${platform} menu entry something to do`, () => {
      const model = buildClientMenu(platform);
      const ids = new Set([
        ...model.menus.flatMap((menu) => actionIds(menu.items)),
        ...actionIds(model.popup),
      ]);
      expect(ids.size).toBeGreaterThan(20);
      for (const id of ids) {
        const ctx = context();
        runMenuAction(id, ctx);
        expect(ctx.failed, id).not.toHaveBeenCalled();
      }
    });
  }

  it("reserves chords only for entries that have one, and keeps closing a panel unreserved", () => {
    const model = buildClientMenu("other");
    const items = [...model.menus.flatMap((menu) => everyItem(menu.items)), ...everyItem(model.popup)];
    const reserved = items.filter((item) => item.chromeOwned);
    expect(reserved.length).toBeGreaterThanOrEqual(10);
    for (const item of reserved) expect(item.accelerator, item.id).toBeTruthy();
    expect(items.find((item) => item.id === "close-panel")?.chromeOwned).toBeUndefined();
  });

  it("raises its own commands as the shell events their handlers already serve", () => {
    const seen: Array<[string, unknown]> = [];
    const off = [
      localShellEvents.on("panel-chrome-command", (p) => seen.push(["panel-chrome-command", p])),
      localShellEvents.on("navigate-about", (p) => seen.push(["navigate-about", p])),
      localShellEvents.on("toggle-find-in-page", () => seen.push(["toggle-find-in-page", null])),
    ];
    runMenuAction("reload-panel", context());
    runMenuAction("about:permissions", context());
    runMenuAction("find", context());
    off.forEach((release) => release());
    expect(seen).toEqual([
      ["panel-chrome-command", { command: "reload-panel" }],
      ["navigate-about", { page: "permissions" }],
      ["toggle-find-in-page", null],
    ]);
  });

  it("hands compositor work to the host and reports a failure instead of swallowing it", async () => {
    const ctx = context();
    runMenuAction("zoom-in", ctx);
    runMenuAction("client-devtools", ctx);
    expect(ctx.panelHost.mock.calls).toEqual([["zoom-in"], ["toggle-client-devtools"]]);
    const failing = context();
    failing.panelHost.mockRejectedValueOnce(new Error("no panel host"));
    runMenuAction("next-panel", failing);
    await vi.waitFor(() => expect(failing.failed).toHaveBeenCalledWith("next-panel", expect.any(Error)));
    runMenuAction("no-such-action", failing);
    expect(failing.failed).toHaveBeenLastCalledWith("no-such-action", expect.any(Error));
  });
});
