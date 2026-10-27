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
  return items.flatMap((item) => [
    item,
    ...(item.submenu ? everyItem(item.submenu) : []),
  ]);
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
        ...actionIds(model.app ?? []),
      ]);
      expect(ids.size).toBeGreaterThan(20);
      for (const id of ids) {
        const ctx = context();
        runMenuAction(id, ctx);
        expect(ctx.failed, id).not.toHaveBeenCalled();
      }
    });
  }

  it("offers Settings from the application menu on macOS and from File elsewhere", () => {
    const mac = buildClientMenu("mac");
    expect(actionIds(mac.app ?? [])).toEqual(["settings"]);
    expect(mac.menus.flatMap((menu) => actionIds(menu.items))).not.toContain(
      "settings",
    );
    const other = buildClientMenu("other");
    expect(other.app).toBeUndefined();
    expect(other.menus.flatMap((menu) => actionIds(menu.items))).toContain(
      "settings",
    );
  });

  it("reserves chords only for entries that have one, and keeps closing a panel unreserved", () => {
    const model = buildClientMenu("other");
    const items = [
      ...model.menus.flatMap((menu) => everyItem(menu.items)),
      ...everyItem(model.popup),
    ];
    const reserved = items.filter((item) => item.chromeOwned);
    expect(reserved.length).toBeGreaterThanOrEqual(10);
    for (const item of reserved) expect(item.accelerator, item.id).toBeTruthy();
    expect(
      items.find((item) => item.id === "close-panel")?.chromeOwned,
    ).toBeUndefined();
  });

  it("disables panel entries and ignores their dispatch while protected Settings are open", () => {
    const menu = buildClientMenu("other", { panelCommandsEnabled: false });
    const items = [
      ...menu.menus.flatMap((group) => everyItem(group.items)),
      ...everyItem(menu.popup),
    ];
    const blocked = [
      "reload-panel",
      "back",
      "focus-address",
      "panel-devtools",
      "next-panel",
      "zoom-in",
    ];
    const observed = vi.fn();
    const releases = [
      localShellEvents.on("panel-chrome-command", observed),
      localShellEvents.on("toggle-panel-devtools", observed),
    ];
    const ctx = { ...context(), menu };
    for (const id of blocked) {
      expect(items.find((item) => item.id === id)?.enabled, id).toBe(false);
      runMenuAction(id, ctx);
    }
    expect(observed).not.toHaveBeenCalled();
    expect(ctx.panelHost).not.toHaveBeenCalled();
    expect(ctx.failed).not.toHaveBeenCalled();
    expect(items.find((item) => item.id === "settings")?.enabled).not.toBe(
      false,
    );
    runMenuAction("toggle-fullscreen", ctx);
    expect(ctx.panelHost).toHaveBeenCalledWith("toggle-fullscreen");
    releases.forEach((release) => release());
  });

  it("raises its own commands as the shell events their handlers already serve", () => {
    const seen: Array<[string, unknown]> = [];
    const off = [
      localShellEvents.on("panel-chrome-command", (p) =>
        seen.push(["panel-chrome-command", p]),
      ),
      localShellEvents.on("navigate-about", (p) =>
        seen.push(["navigate-about", p]),
      ),
      localShellEvents.on("toggle-find-in-page", () =>
        seen.push(["toggle-find-in-page", null]),
      ),
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
    expect(ctx.panelHost.mock.calls).toEqual([
      ["zoom-in"],
      ["toggle-client-devtools"],
    ]);
    const failing = context();
    failing.panelHost.mockRejectedValueOnce(new Error("no panel host"));
    runMenuAction("next-panel", failing);
    await vi.waitFor(() =>
      expect(failing.failed).toHaveBeenCalledWith(
        "next-panel",
        expect.any(Error),
      ),
    );
    runMenuAction("no-such-action", failing);
    expect(failing.failed).toHaveBeenLastCalledWith(
      "no-such-action",
      expect.any(Error),
    );
  });
});
