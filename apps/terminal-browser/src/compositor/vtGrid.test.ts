import { describe, expect, it, vi } from "vitest";
import { ATTR_BOLD, ATTR_INVERSE, Screen } from "./screen.js";
import { VtGrid } from "./vtGrid.js";

describe("VtGrid", () => {
  it("copies and searches wrapped Unicode logical lines while preserving hard newlines", async () => {
    const grid = new VtGrid({ columns: 8, rows: 5 });
    await grid.write("echo A界BC xyz\r\nnext");
    expect(grid.logicalLineText(1)).toBe("echo A界BC xyz");
    expect(grid.retainedText()).toMatch(/^echo A界BC xyz\nnext/);
    expect(grid.selectedText({ start: { x: 0, y: 0 }, end: { x: 3, y: 2 } })).toBe(
      "echo A界BC xyz\nnext"
    );
    const [match] = grid.search("界BC");
    expect(match).toMatchObject({ start: { x: 6, y: 0 }, end: { x: 1, y: 1 } });
    expect(grid.selectedText(match!)).toBe("界BC");
    expect(grid.search("xyznext")).toEqual([]);
    grid.dispose();
  });
  it("copies terminal columns rather than UTF-16 indices", async () => {
    const grid = new VtGrid({ columns: 20, rows: 2 });
    await grid.write("A界B👩‍💻C");
    expect(grid.lineText(0, false, 3, 4)).toBe("B");
    grid.dispose();
  });

  it("gives emoji the two cells Ink and real terminals give them", async () => {
    const grid = new VtGrid({ columns: 12, rows: 1 });
    await grid.write("1:💬 Chat");
    const screen = new Screen(12, 1);
    grid.paint(screen, { x: 0, y: 0, width: 12, height: 1 });
    expect(screen.widths[2]).toBe(2);
    expect(screen.rowText(0)).toBe("1:💬 Chat");
    expect(screen.chars[8]).toBe("t");
    grid.dispose();
  });

  it("tracks enhanced keyboard ownership independently across screen buffers", async () => {
    const reply = vi.fn();
    const grid = new VtGrid({ columns: 20, rows: 2 }, { signals: { reply } });
    await grid.write("\x1b[>1u\x1b[?u");
    expect(grid.disambiguatedKeys()).toBe(true);
    expect(reply).toHaveBeenLastCalledWith("\x1b[?1u");
    await grid.write("\x1b[?1049h");
    expect(grid.disambiguatedKeys()).toBe(false);
    await grid.write("\x1b[>1u\x1b[<u");
    expect(grid.disambiguatedKeys()).toBe(false);
    await grid.write("\x1b[?1049l");
    expect(grid.disambiguatedKeys()).toBe(true);
    await grid.write("\x1b[<u");
    expect(grid.disambiguatedKeys()).toBe(false);
    grid.dispose();
  });
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

describe("VtGrid signals", () => {
  it("reports titles, notifications and clipboard writes", async () => {
    const title = vi.fn();
    const attention = vi.fn();
    const copy = vi.fn();
    const grid = new VtGrid({ columns: 20, rows: 3 }, { signals: { title, attention, copy } });
    await grid.write("\x1b]0;first\x07\x1b]2;second\x1b\\");
    expect(title.mock.calls).toEqual([["first"], ["second"]]);
    await grid.write("\x1b]9;done\x07\x1b]9;4;1;50\x07\x1b]777;notify;Build;passed\x07");
    expect(attention.mock.calls).toEqual([["done"], ["Build: passed"]]);
    await grid.write(`\x1b]52;c;${Buffer.from("hi").toString("base64")}\x07\x1b]52;c;?\x07`);
    expect(copy.mock.calls).toEqual([["hi"]]);
    grid.dispose();
  });

  it("locates OSC 8 links, keeps them through scrolling and lists them newest first", async () => {
    const grid = new VtGrid({ columns: 30, rows: 3 }, { scrollback: 3 });
    await grid.write("top\r\nsee \x1b]8;;https://a.example/x\x1b\\docs\x1b]8;;\x1b\\ and ");
    await grid.write("\x1b]8;id=1;https://b.example\x07b\x1b]8;;\x07\r\n");
    expect(grid.linkAt(4, 1)).toBe("https://a.example/x");
    expect(grid.linkAt(7, 1)).toBe("https://a.example/x");
    expect(grid.linkAt(8, 1)).toBeNull();
    expect(grid.linkAt(13, 1)).toBe("https://b.example");
    // The buffer is full: the oldest line is trimmed and every line moves up one.
    await grid.write("1\r\n2\r\n3\r\n4\r\n");
    expect(grid.lineText(0)).toContain("see docs");
    expect(grid.linkAt(4, 0)).toBe("https://a.example/x");
    expect(grid.linkAt(4, 1)).toBeNull();
    await grid.write("\x1b]8;;https://a.example/x\x07again\x1b]8;;\x07");
    expect(grid.links()).toEqual(["https://a.example/x", "https://b.example"]);
    grid.reset();
    expect(grid.links()).toEqual([]);
    grid.dispose();
  });

  it("tracks focus reporting and forgets tracked modes on RIS", async () => {
    const grid = new VtGrid({ columns: 10, rows: 2 });
    await grid.write("\x1b[?1004h\x1b[?25l\x1b]8;;https://x.example\x07x\x1b]8;;\x07");
    expect(grid.reportsFocus()).toBe(true);
    expect(grid.cursor().visible).toBe(false);
    await grid.resetInOrder();
    expect(grid.reportsFocus()).toBe(false);
    expect(grid.cursor().visible).toBe(true);
    expect(grid.links()).toEqual([]);
    grid.dispose();
  });
});
