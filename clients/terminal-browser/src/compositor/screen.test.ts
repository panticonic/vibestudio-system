import { describe, expect, it } from "vitest";
import { ATTR_BOLD, RGB_FLAG, Screen, paintDiff } from "./screen.js";

const hidden = { x: 0, y: 0, visible: false };
const strip = (bytes: string) => bytes.replace("\x1b[?2026h", "").replace("\x1b[?2026l", "");

describe("paintDiff", () => {
  it("paints a full frame wrapped in synchronized output, skipping blank cells", () => {
    const screen = new Screen(10, 2);
    screen.text(0, 0, "hi");
    const bytes = paintDiff(null, screen, hidden, null);
    expect(bytes.startsWith("\x1b[?2026h")).toBe(true);
    expect(bytes.endsWith("\x1b[?2026l")).toBe(true);
    expect(bytes).toContain("\x1b[2J");
    expect(bytes).toContain("\x1b[1;1Hhi");
    expect(bytes).not.toContain("\x1b[2;1H");
  });

  it("writes nothing when neither cells nor cursor changed", () => {
    const a = new Screen(5, 1);
    a.text(0, 0, "abc");
    const b = new Screen(5, 1);
    b.text(0, 0, "abc");
    expect(paintDiff(a, b, hidden, hidden)).toBe("");
  });

  it("emits only changed cells, addressing each run once", () => {
    const a = new Screen(10, 2);
    a.text(0, 0, "hello");
    a.text(0, 1, "world");
    const b = new Screen(10, 2);
    b.text(0, 0, "hello");
    b.text(0, 1, "wOrlD");
    const bytes = strip(paintDiff(a, b, hidden, hidden));
    expect(bytes).toBe("\x1b[?25l\x1b[2;2HO\x1b[2;5HD");
  });

  it("encodes colors and attributes as SGR and resets the pen afterwards", () => {
    const a = new Screen(4, 1);
    const b = new Screen(4, 1);
    b.set(0, 0, "x", 1, 1, RGB_FLAG | 0x102030, ATTR_BOLD);
    const bytes = paintDiff(a, b, hidden, hidden);
    expect(bytes).toContain("\x1b[0;1;31;48;2;16;32;48mx");
    expect(bytes).toContain("\x1b[0m");
  });

  it("re-addresses the cell after a wide character", () => {
    const a = new Screen(6, 1);
    const b = new Screen(6, 1);
    b.text(0, 0, "a");
    b.set(1, 0, "中", 2, -1, -1, 0);
    b.text(3, 0, "b");
    const bytes = strip(paintDiff(a, b, hidden, hidden));
    expect(bytes).toBe("\x1b[?25l\x1b[1;1Ha中\x1b[1;4Hb");
  });

  it("repaints a cell that replaces the right half of a wide character", () => {
    const a = new Screen(4, 1);
    a.set(0, 0, "中", 2, -1, -1, 0);
    const b = new Screen(4, 1);
    b.text(0, 0, "ab");
    const bytes = strip(paintDiff(a, b, hidden, hidden));
    expect(bytes).toBe("\x1b[?25l\x1b[1;1Hab");
  });

  it("places and shows the cursor, and hides it when asked", () => {
    const a = new Screen(4, 2);
    const b = new Screen(4, 2);
    expect(strip(paintDiff(a, b, { x: 2, y: 1, visible: true }, hidden))).toBe(
      "\x1b[?25l\x1b[2;3H\x1b[?25h"
    );
    expect(strip(paintDiff(b, b, hidden, { x: 2, y: 1, visible: true }))).toBe("\x1b[?25l");
  });

  it("repaints fully after a size change", () => {
    const a = new Screen(4, 1);
    const b = new Screen(5, 1);
    b.text(0, 0, "x");
    expect(paintDiff(a, b, hidden, hidden)).toContain("\x1b[2J");
  });
});

describe("Screen", () => {
  it("keeps wide characters consistent when overwritten", () => {
    const s = new Screen(4, 1);
    s.set(1, 0, "中", 2, -1, -1, 0);
    s.set(2, 0, "x", 1, -1, -1, 0); // overwrite right half
    expect(s.rowText(0)).toBe("  x");
    s.set(3, 0, "中", 2, -1, -1, 0); // cannot straddle the edge
    expect(s.widths[3]).toBe(1);
  });
});
