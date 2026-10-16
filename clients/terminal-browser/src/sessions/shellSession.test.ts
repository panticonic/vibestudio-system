import { describe, expect, it, vi } from "vitest";
import { FakeShell } from "../testing/fakeShell.js";
import { encodePtyStreamEvent } from "@workspace/pty-stream";
import type { TerminalSessionEntry } from "./launcher.js";
import { ShellSessionTab, describeError, type SessionEvents } from "./shellSession.js";

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
    exited: vi.fn(),
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
  it("joins cancellation of a live PTY reader before disposing its grid", async () => {
    const { shell, tab } = setup();
    let releaseCancel!: () => void;
    const cancelled = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseCancel = resolve;
        })
    );
    vi.spyOn(shell, "attach").mockResolvedValue(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            for (const bytes of encodePtyStreamEvent({
              kind: "hello",
              attachId: "held",
              epoch: 1,
              start: 0,
              cursor: 0,
              alive: true,
              cols: 40,
              rows: 5,
            }))
              controller.enqueue(bytes);
          },
          cancel: cancelled,
        })
      )
    );
    const attached = tab.attach(true, true);
    await until(() => tab.isLive(), "live owned reader");
    let disposed = false;
    const disposal = tab.dispose().then(() => {
      disposed = true;
    });
    await until(() => cancelled.mock.calls.length > 0, "reader cancellation admitted");
    try {
      await new Promise((resolve) => setImmediate(resolve));
      expect(disposed).toBe(false);
    } finally {
      releaseCancel();
      await disposal;
      await attached;
    }
    expect(disposed).toBe(true);
  });
  it("retains all nested failure evidence for full error inspection", () => {
    const cause = new Error("original provider failure");
    const cleanup = new Error("source cancellation failed");
    expect(describeError(new AggregateError([cause, cleanup], "Operation failed"))).toBe(
      "Operation failed\nCaused by: original provider failure\nCaused by: source cancellation failed"
    );
  });
  it("joins a held attachment head and its body cancellation before disposing", async () => {
    const { shell, tab } = setup();
    let releaseHead!: (response: Response) => void;
    let releaseCancel!: () => void;
    const cancelled = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseCancel = resolve;
        })
    );
    vi.spyOn(shell, "attach").mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseHead = resolve;
        })
    );
    const attached = tab.attach(true, true);
    await until(() => !!releaseHead, "attachment head admitted");
    let disposed = false;
    const disposal = tab.dispose().then(() => {
      disposed = true;
    });
    await Promise.resolve();
    expect(disposed).toBe(false);
    releaseHead(new Response(new ReadableStream({ cancel: cancelled })));
    await until(() => cancelled.mock.calls.length > 0, "owned response cancellation");
    expect(disposed).toBe(false);
    releaseCancel();
    await disposal;
    await attached;
    expect(disposed).toBe(true);
  });

  it("rejects input visibly while attaching instead of silently losing it", async () => {
    const { shell, shellSessionId, tab, events } = setup();
    tab.sendInput("not delivered");
    expect(shell.typed(shellSessionId)).toBe("");
    expect(events.log).toHaveBeenCalledWith("warn", "Echo: input was not sent (attaching)");
    await tab.dispose();
  });
  it("replays retained output at its size, then streams and acknowledges output", async () => {
    const { shell, shellSessionId, tab, screen } = setup();
    shell.emit(shellSessionId, "before\r\n");
    void tab.attach(true, true);
    await until(() => tab.isLive() && screen().includes("before"), "replay");
    expect(shell.attachCalls[0]!.options).toEqual({
      size: { cols: 40, rows: 5 },
    });
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
