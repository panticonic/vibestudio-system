// @vitest-environment jsdom

import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UnitIcon } from "./UnitIcon";

const icons = vi.hoisted(() => ({
  load: vi.fn(async () => "blob:owned-workspace-icon")
}));
vi.mock("./workspaceIconsContext", () => ({
  useWorkspaceIcons: () => icons
}));
afterEach(() => {
  cleanup();
  icons.load.mockClear();
});

describe("UnitIcon", () => {
  it.each(["target", "lucide:target", "🎯 Mission", "💬🎯", "./../icon.svg"])(
    "uses the panel glyph instead of rendering invalid text icon %s",
    (icon) => {
      const { container } = render(<UnitIcon icon={icon} fallback="panel" />);
      expect(container.textContent).toBe("");
      expect(container.querySelector("svg")).not.toBeNull();
      expect(icons.load).not.toHaveBeenCalled();
    }
  );

  it("renders a declared semantic icon at the requested breadcrumb size", () => {
    const { getByText } = render(<UnitIcon icon="💬" size={17} fallback="panel" />);
    const icon = getByText("💬");
    expect(icon.style.width).toBe("17px");
    expect(icon.style.height).toBe("17px");
  });

  it("resolves a real image through the immutable unit-icon route", async () => {
    const iconVersion = "a".repeat(64);
    const iconState = "b".repeat(64);
    const { container } = render(
      <UnitIcon
        icon="./assets/icon.svg"
        iconVersion={iconVersion}
        iconState={iconState}
        source="workers/mail"
        fallback="worker"
      />
    );
    await waitFor(() => expect(container.querySelector("img")).not.toBeNull());
    const image = container.querySelector("img");
    expect(image?.getAttribute("src")).toBe("blob:owned-workspace-icon");
    expect(icons.load).toHaveBeenCalledWith(
      "workers/mail",
      "./assets/icon.svg",
      iconVersion,
      iconState
    );
    expect(image?.getAttribute("loading")).toBe("lazy");
    expect(image?.getAttribute("decoding")).toBe("async");
  });

  it("uses the typed fallback if a declared image cannot be loaded", async () => {
    const { container } = render(
      <UnitIcon icon="./assets/icon.svg" source="workers/mail" fallback="worker" />
    );
    await waitFor(() => expect(container.querySelector("img")).not.toBeNull());
    fireEvent.error(container.querySelector("img")!);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("svg")).not.toBeNull();
    expect(container.textContent).not.toContain("./assets/icon.svg");
  });

  it("uses distinct glyphs for panel, browser, worker, client, and extension fallbacks", () => {
    const kinds = ["panel", "browser", "worker", "client", "extension"] as const;
    const glyphs = kinds.map((fallback) => {
      const { container, unmount } = render(<UnitIcon fallback={fallback} />);
      const markup = container.innerHTML;
      unmount();
      return markup;
    });
    expect(new Set(glyphs).size).toBe(kinds.length);
  });
});
