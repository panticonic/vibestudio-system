import { describe, expect, it } from "vitest";
import { tabWindow } from "./chrome.js";

describe("tab window", () => {
  it("keeps every focused tab visible and shares paint/mouse coordinates within available width", () => {
    for (const width of [40, 80, 100])
      for (let focused = 0; focused < 30; focused++) {
        const window = tabWindow(30, focused, width);
        expect(window.first).toBeLessThanOrEqual(focused);
        expect(window.first + window.count).toBeGreaterThan(focused);
        expect(window.inset * 2 + window.count * window.share).toBeLessThanOrEqual(width);
        const cell = window.inset + (focused - window.first) * window.share;
        expect(window.first + Math.floor((cell - window.inset) / window.share)).toBe(focused);
      }
  });
});
