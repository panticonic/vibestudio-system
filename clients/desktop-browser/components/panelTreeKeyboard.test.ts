import { describe, expect, it } from "vitest";
import { panelTreeKeyboardTarget } from "./panelTreeKeyboard";

describe("panel tree keyboard navigation", () => {
  it("crosses an offscreen page and skips load-more rows", () => {
    const rows = [
      ...Array.from({ length: 50 }, (_, index) => `panel-${index}`),
      null,
      ...Array.from({ length: 50 }, (_, index) => `panel-${index + 50}`),
    ];
    expect(panelTreeKeyboardTarget(rows, "panel-49", "ArrowDown")).toBe(51);
    expect(panelTreeKeyboardTarget(rows, "panel-50", "ArrowUp")).toBe(49);
    expect(panelTreeKeyboardTarget(rows, "panel-0", "End")).toBe(100);
    expect(panelTreeKeyboardTarget(rows, "panel-99", "Home")).toBe(0);
  });
});
