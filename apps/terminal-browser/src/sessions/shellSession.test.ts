import { describe, expect, it, vi } from "vitest";
import { FakeShell } from "../testing/fakeShell.js";
import type { TerminalSessionEntry } from "./launcher.js";
import { ShellSessionTab, type SessionEvents } from "./shellSession.js";

async function until(predicate: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`timed out waiting for ${what}`);
}

function setup() {
  const shell = new FakeShell();
  const shellSessionId = shell.create();
  const entry: TerminalSessionEntry = {
    sessionId: "term-1",
    kind: "app",
    source: "terminal-apps/echo",
    title: "Echo",
    principalId: "code:echo",
    shellSessionId,
    running: true,
    createdAt: 1,
    lastActiveAt: 2,
  };
  const events = {
    changed: vi.fn(),
    output: vi.fn(),
    bell: vi.fn(),
    copy: vi.fn(),
    log: vi.fn(),
  } satisfies SessionEvents;
  const tab = new ShellSessionTab(shell, entry, { columns: 40, rows: 5 }, events);
  const screen = () =>
    Array.from({ length: tab.grid.length() }, (_, y) => tab.grid.lineText(y)).join("\n");
  return { shell, shellSessionId, entry, events, tab, screen };
}

describe("ShellSessionTab", () => {
  it("replays retained output at its size, then streams and acknowledges output", async () => {
    const { shell, shellSessionId, tab, screen } = setup();
    shell.emit(shellSessionId, "before\r\n");
    void tab.attach(true, true);
    await until(() => tab.isLive() && screen().includes("before"), "replay");
    expect(shell.attachCalls[0]!.options).toEqual({ size: { cols: 40, rows: 5 } });
    shell.emit(shellSessionId, "after");
    await until(() => screen().includes("after"), "live output");
    tab.sendInput("ls\r");
    await until(() => shell.typed(shellSessionId) === "ls\r", "input");
    tab.dispose();
  });

  it("turns program control sequences into tab chrome", async () => {
    const { shell, shellSessionId, tab, events } = setup();
    void tab.attach(false, true);
    await until(() => tab.isLive(), "attach");
    shell.emit(shellSessionId, "\x1b]2;Build log\x07");
    await until(() => tab.title !== "Echo", "title");
    expect(tab.title).toBe("Build log");
    shell.emit(shellSessionId, "\x1b]9;Tests finished\x07");
    await until(() => tab.attention === "Tests finished", "OSC 9 attention");
    tab.setFocused(true);
    expect(tab.attention).toBeNull();
    tab.setFocused(false);
    shell.emit(shellSessionId, "\x07");
    await until(() => events.bell.mock.calls.length === 1, "bell");
    expect(tab.attention).toBe("bell");
    shell.emit(shellSessionId, `\x1b]52;c;${Buffer.from("copied ✓").toString("base64")}\x07`);
    await until(() => events.copy.mock.calls.length === 1, "OSC 52");
    expect(events.copy).toHaveBeenCalledWith(tab, "copied ✓");
    tab.dispose();
  });

  it("reports focus changes only to programs that asked for them", async () => {
    const { shell, shellSessionId, tab } = setup();
    void tab.attach(true, true);
    await until(() => tab.isLive(), "attach");
    tab.setFocused(false);
    shell.emit(shellSessionId, "\x1b[?1004h");
    await until(() => tab.grid.reportsFocus(), "focus mode");
    tab.setFocused(true);
    await until(() => shell.typed(shellSessionId) === "\x1b[I", "focus-in report");
    tab.dispose();
  });

  it("shows the exit and resumes after the last received byte when reattaching", async () => {
    const { shell, shellSessionId, tab, screen } = setup();
    shell.emit(shellSessionId, "one ");
    void tab.attach(true, true);
    await until(() => screen().includes("one"), "replay");
    shell.dropAttachments();
    await until(() => tab.status.kind === "error", "lost attachment");
    shell.emit(shellSessionId, "two");
    void tab.attach(true, false);
    await until(() => screen().includes("one two"), "resumed output");
    expect(shell.attachCalls[1]!.options).toEqual({
      after: { epoch: 1, cursor: 4 },
      size: { cols: 40, rows: 5 },
    });
    expect(screen().match(/one/g)).toHaveLength(1);
    shell.exit(shellSessionId, 3);
    await until(() => tab.status.kind === "exited", "exit");
    expect(tab.status).toEqual({ kind: "exited", code: 3 });
    tab.dispose();
  });

  it("asks for a fresh attach when the session was relaunched in a new PTY", () => {
    const { tab, entry } = setup();
    expect(tab.updateEntry({ ...entry, lastActiveAt: 9 })).toBe(false);
    expect(tab.updateEntry({ ...entry, shellSessionId: "pty-new" })).toBe(true);
    tab.dispose();
  });
});
