import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { page, userEvent } from "@vitest/browser/context";
const mock = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("@workspace/react/theme", () => ({
  usePanelTheme: () => "light",
  usePanelThemeConfig: () => ({ accentColor: "blue", grayColor: "slate" }),
}));
vi.mock("@workspace/react/responsive", () => ({
  useIsMobile: () => window.innerWidth < 640,
}));
vi.mock("@workspace/react", () => ({
  useIsMobile: () => window.innerWidth < 640,
}));
vi.mock("@workspace/runtime", () => ({ rpc: { call: mock.call } }));
import Adblock from "./index";
afterEach(cleanup);
beforeEach(() => {
  const config = {
    enabled: true,
    lists: { ads: true, privacy: true, annoyances: false, social: false },
    customLists: ["https://example.test/filters.txt"],
    whitelist: ["example.test"],
  };
  mock.call
    .mockReset()
    .mockImplementation(
      async (_target: string, method: string, args: unknown[]) => {
        if (method === "adblock.getConfig") return { ...config };
        if (method === "adblock.getStats")
          return { blockedRequests: 42, blockedElements: 10 };
        if (method === "adblock.removeCustomList")
          config.customLists = config.customLists.filter(
            (url) => url !== args[0],
          );
        if (method === "adblock.removeFromWhitelist")
          config.whitelist = config.whitelist.filter(
            (domain) => domain !== args[0],
          );
        return null;
      },
    );
});
it.each([320, 390, 1280])(
  "labels settings and retains keyboard focus after removal at %i pixels",
  async (width) => {
    await page.viewport(width, 1000);
    render(<Adblock />);
    const remove = await screen.findByRole("button", {
      name: "Remove https://example.test/filters.txt",
    });
    remove.focus();
    await userEvent.keyboard("{Enter}");
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByLabelText("Filter list URL"),
      ),
    );
    const removeDomain = screen.getByRole("button", {
      name: "Remove example.test",
    });
    removeDomain.focus();
    await userEvent.keyboard("{Enter}");
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByLabelText("Domain to whitelist"),
      ),
    );
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width + 1);
    await page.screenshot();
  },
);
