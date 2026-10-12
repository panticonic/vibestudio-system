import { describe, expect, it } from "vitest";
import { ATTR_BOLD, ATTR_INVERSE, Screen } from "./screen.js";
import { VtGrid } from "./vtGrid.js";

describe("VtGrid", () => {
  it("emulates Ink-style output (bare LF, relative redraws) into cells with styles", async () => {
    const grid = new VtGrid({ columns: 20, rows: 3 });
    await grid.write("count = 1\n");
    await grid.write("\x1b[1A\x1b[2K\x1b[1;31mcount = 2\x1b[0m\n");
    const screen = new Screen(20, 3);
    grid.paint(screen, { x: 0, y: 0, width: 20, height: 3 });
    expect(screen.rowText(0)).toBe("count = 2");
    expect(screen.fg[0]).toBe(1);
    expect(screen.attrs[0]! & ATTR_BOLD).toBe(ATTR_BOLD);
    grid.dispose();
  });

  it("tracks cursor visibility, mouse modes and paste mode the program requested", async () => {
    const grid = new VtGrid({ columns: 10, rows: 2 });
    expect(grid.cursor().visible).toBe(true);
    await grid.write("ab\x1b[?25l\x1b[?1002h\x1b[?1006h\x1b[?2004h");
    expect(grid.cursor()).toEqual({ x: 2, y: 0, visible: false });
    expect(grid.mouseMode()).toEqual({ tracking: "drag", sgr: true });
    expect(grid.bracketedPaste()).toBe(true);
    await grid.write("\x1b[?25h\x1b[?1002l");
    expect(grid.cursor().visible).toBe(true);
    expect(grid.mouseMode().tracking).toBe("none");
    grid.reset();
    expect(grid.mouseMode()).toEqual({ tracking: "none", sgr: false });
    grid.dispose();
  });

  it("paints scrollback and highlights a selection", async () => {
    const grid = new VtGrid({ columns: 10, rows: 2 });
    await grid.write("one\ntwo\nthree\nfour");
    expect(grid.scrollbackLength()).toBe(2);
    const screen = new Screen(10, 2);
    grid.paint(
      screen,
      { x: 0, y: 0, width: 10, height: 2 },
      {
        scrollback: 2,
        selection: { start: { x: 0, y: 0 }, end: { x: 1, y: 0 } },
      }
    );
    expect(screen.rowText(0)).toBe("one");
    expect(screen.rowText(1)).toBe("two");
    expect(screen.attrs[0]! & ATTR_INVERSE).toBe(ATTR_INVERSE);
    expect(screen.attrs[2]! & ATTR_INVERSE).toBe(0);
    grid.dispose();
  });
});
