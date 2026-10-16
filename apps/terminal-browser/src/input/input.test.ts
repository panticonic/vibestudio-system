import { describe, expect, it } from "vitest";
import { fuzzyFilter, fuzzyMatch } from "./fuzzy.js";
import { KeyRouter, prefixBytes, isPrefixKeyId } from "./keymap.js";
import { parseSettings } from "../settings.js";
import { InputTokenizer, navKeyOf, type InputEvent, type KeyEvent } from "./tokenizer.js";

const names = (events: InputEvent[]) => events.map((e) => (e.kind === "key" ? e.name : e.kind));

describe("InputTokenizer", () => {
  it("names keys and keeps their exact bytes", () => {
    const t = new InputTokenizer();
    const events = t.push("a\x1b[A\x1bOB\x1b[5~\x1b[1;5C\x00\x01\r\x7f\x1bx\x1b[Z") as KeyEvent[];
    expect(events.map((e) => e.name)).toEqual([
      "a",
      "up",
      "down",
      "pageup",
      "C-right",
      "C-space",
      "C-a",
      "enter",
      "backspace",
      "M-x",
      "backtab",
    ]);
    expect(events[1]!.seq).toBe("\x1b[A");
  });

  it("holds ambiguous legacy ESC and resolves it only through authoritative input", () => {
    const tokenizer = new InputTokenizer();
    expect(tokenizer.push("\x1b")).toEqual([]);
    expect(names(tokenizer.push("[A"))).toEqual(["up"]);
    expect(tokenizer.push("\x1b")).toEqual([]);
    expect(names(tokenizer.push("\x07x"))).toEqual(["C-g", "x"]);
  });
  it("preserves the session's raw bytes when explicit Ctrl-G resolves a pending legacy ESC", () => {
    const tokenizer = new InputTokenizer();
    expect(tokenizer.push("\x1b")).toEqual([]);
    expect(tokenizer.push("\x07")).toEqual([{ kind: "key", name: "C-g", seq: "\x1b\x07" }]);
    expect(names(tokenizer.push("x"))).toEqual(["x"]);
  });

  it("decodes enhanced Escape and control keys without a timing heuristic", () => {
    const tokenizer = new InputTokenizer();
    expect(names(tokenizer.push("\x1b[27u\x1b[99;5u\x1b[32;5u\x1b[?1u"))).toEqual([
      "escape",
      "C-c",
      "C-space",
    ]);
  });

  it("does not split an initial ESC away from a fragmented paste", () => {
    const tokenizer = new InputTokenizer();
    expect(tokenizer.push("\x1b")).toEqual([]);
    expect(tokenizer.push("[200~1\x00q")).toEqual([]);
    expect(tokenizer.push("\x1b[201~")).toEqual([{ kind: "paste", text: "1\x00q" }]);
  });

  it("reassembles escape sequences split across reads", () => {
    const t = new InputTokenizer();
    expect(t.push("\x1b[1;")).toEqual([]);
    expect(names(t.push("5A"))).toEqual(["C-up"]);
  });

  it("collects bracketed pastes across reads, including split end markers", () => {
    const t = new InputTokenizer();
    expect(t.push("\x1b[200~hello \x00 wo")).toEqual([]);
    expect(t.push("rld\x1b[20")).toEqual([]);
    expect(t.push("1~x")).toEqual([
      { kind: "paste", text: "hello \x00 world" },
      { kind: "key", name: "x", seq: "x" },
    ]);
  });

  it("decodes SGR mouse reports", () => {
    const [press, wheel, release] = new InputTokenizer().push(
      "\x1b[<0;5;3M\x1b[<64;1;1M\x1b[<0;5;3m"
    );
    expect(press).toMatchObject({
      kind: "mouse",
      action: "press",
      x: 4,
      y: 2,
      button: 0,
    });
    expect(wheel).toMatchObject({ kind: "mouse", action: "wheel-up" });
    expect(release).toMatchObject({ kind: "mouse", action: "release" });
  });

  it("decodes UTF-8 split across chunks", () => {
    const t = new InputTokenizer();
    const bytes = new TextEncoder().encode("é");
    expect(t.push(bytes.subarray(0, 1))).toEqual([]);
    expect(names(t.push(bytes.subarray(1)))).toEqual(["é"]);
  });

  it("maps keys to overlay navigation", () => {
    const key = (name: string) => ({ kind: "key" as const, name, seq: "" });
    expect(navKeyOf(key("up"))).toBe("up");
    expect(navKeyOf(key("3"))).toEqual({ digit: 3 });
    expect(navKeyOf(key(" "))).toEqual({ char: " " });
    expect(navKeyOf(key("C-x"))).toBeNull();
  });
});

describe("KeyRouter", () => {
  const route = (router: KeyRouter, text: string) => router.route(new InputTokenizer().push(text));
  it("reserves Ctrl-G for browser cancellation, including prefix-armed fragmented ESC", () => {
    expect(isPrefixKeyId("C-g")).toBe(false);
    expect(parseSettings({ prefixKey: "C-g" }).prefixKey).toBe("C-b");
    const router = new KeyRouter("C-space");
    const tokenizer = new InputTokenizer();
    router.route(tokenizer.push("\x00\x1b"));
    expect(router.route(tokenizer.push("\x07"))).toEqual([{ kind: "prefix", pending: false }, { kind: "command", command: { kind: "cancel" } }]);
    expect(router.pending).toBe(false);
    expect(router.route(tokenizer.push("x"))).toEqual([{ kind: "input", event: { kind: "key", name: "x", seq: "x" } }]);
  });

  it("passes every key but the prefix through to the focused target", () => {
    const router = new KeyRouter("C-space");
    const out = route(router, "ab\x01\x0c\x10");
    expect(out.every((r) => r.kind === "input")).toBe(true);
    expect(out).toHaveLength(5);
  });

  it("turns prefix + key into a command and reports the pending state", () => {
    const router = new KeyRouter("C-space");
    expect(route(router, "\x00")).toEqual([{ kind: "prefix", pending: true }]);
    expect(router.pending).toBe(true);
    expect(route(router, "k")).toEqual([
      { kind: "prefix", pending: false },
      { kind: "command", command: { kind: "palette" } },
    ]);
    expect(route(router, "\x003")).toContainEqual({
      kind: "command",
      command: { kind: "tab", index: 2 },
    });
    expect(route(router, "\x00[")).toContainEqual({
      kind: "command",
      command: { kind: "copy-mode" },
    });
  });

  it("sends the prefix literally when pressed twice, cancels on Escape, reports unbound keys", () => {
    const router = new KeyRouter("C-a");
    expect(route(router, "\x01\x01")).toContainEqual({
      kind: "command",
      command: { kind: "send-prefix" },
    });
    expect(prefixBytes("C-a")).toBe("\x01");
    expect(route(router, "\x01\x1b[27u")).toEqual([
      { kind: "prefix", pending: true },
      { kind: "prefix", pending: false },
    ]);
    expect(route(router, "\x01Z")).toContainEqual({
      kind: "unbound",
      key: "Z",
    });
    expect(router.pending).toBe(false);
  });

  it("never treats keys inside a paste as the prefix", () => {
    const router = new KeyRouter("C-space");
    const out = route(router, "\x1b[200~\x00k\x1b[201~");
    expect(out).toEqual([{ kind: "input", event: { kind: "paste", text: "\x00k" } }]);
  });

  it("keeps the prefix armed through a click, for the menu to hit-test, until cancelled", () => {
    const router = new KeyRouter("C-b");
    route(router, "\x02");
    const out = route(router, "\x1b[<0;5;5M");
    expect(out).toEqual([{ kind: "input", event: expect.objectContaining({ kind: "mouse" }) }]);
    expect(router.pending).toBe(true);
    router.cancel();
    expect(router.pending).toBe(false);
    expect(route(router, "?")).toEqual([
      { kind: "input", event: expect.objectContaining({ kind: "key", name: "?" }) },
    ]);
  });

  it("follows a changed prefix", () => {
    const router = new KeyRouter("C-space");
    router.setPrefix("C-b");
    expect(route(router, "\x00")[0]).toMatchObject({ kind: "input" });
    expect(route(router, "\x02?")).toContainEqual({
      kind: "command",
      command: { kind: "help" },
    });
  });
});

describe("fuzzy matching", () => {
  it("matches subsequences case-insensitively and reports positions", () => {
    expect(fuzzyMatch("slg", "Server Logs")?.positions).toEqual([0, 7, 9]);
    expect(fuzzyMatch("xyz", "Server Logs")).toBeNull();
    expect(fuzzyMatch("", "anything")).toEqual({ score: 0, positions: [] });
  });

  it("ranks word-start and contiguous matches first and keeps order for ties", () => {
    const items = ["Settings", "Server Logs", "Switch workspace", "Resume: Server Logs"];
    expect(fuzzyFilter(items, "sl", (x) => x).map((r) => r.item)[0]).toBe("Server Logs");
    expect(fuzzyFilter(items, "log", (x) => x).map((r) => r.item)).toEqual([
      "Server Logs",
      "Resume: Server Logs",
    ]);
    expect(fuzzyFilter(items, "", (x) => x).map((r) => r.item)).toEqual(items);
  });
});
