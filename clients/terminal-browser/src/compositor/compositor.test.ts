import { describe, expect, it } from "vitest";
import { Compositor } from "./compositor.js";

describe("Compositor", () => {
  it("coalesces invalidations within one event-loop turn into one paint", async () => {
    const writes: string[] = [];
    let composed = 0;
    let text = "a";
    const compositor = new Compositor(
      { write: (data) => writes.push(data) },
      () => ({ columns: 5, rows: 1 }),
      (screen) => {
        composed += 1;
        screen.text(0, 0, text);
        return { x: 0, y: 0, visible: false };
      }
    );
    compositor.invalidate();
    compositor.invalidate();
    compositor.invalidate();
    await new Promise((resolve) => setImmediate(resolve));
    expect(composed).toBe(1);
    expect(writes).toHaveLength(1);

    // Unchanged frame: composed but nothing written.
    compositor.invalidate();
    await new Promise((resolve) => setImmediate(resolve));
    expect(composed).toBe(2);
    expect(writes).toHaveLength(1);

    text = "b";
    compositor.invalidate();
    await new Promise((resolve) => setImmediate(resolve));
    expect(writes[1]).toContain("b");
    expect(writes[1]).not.toContain("\x1b[2J");

    compositor.invalidateAll();
    await new Promise((resolve) => setImmediate(resolve));
    expect(writes[2]).toContain("\x1b[2J");
    compositor.stop();
  });
});
