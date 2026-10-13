import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import xterm from "@xterm/headless";
import type { RpcClient } from "@vibestudio/rpc";
import type { PendingApproval } from "@vibestudio/shared/approvals";
import { encodeEventWatchRecord } from "@vibestudio/shared/events";
import type {
  TerminalBrowserExit,
  TerminalBrowserHost,
  TerminalServerConnectionState,
} from "@vibestudio/shell-core/terminal/terminalBrowserHost";
import { TerminalBrowser } from "./browser.js";
import { run } from "./index.js";
import { TerminalServiceUnavailableError, type TerminalSessionEntry } from "./sessions/launcher.js";
import { FakeShell, FakeTerminalSessions } from "./testing/fakeShell.js";

const { Terminal } = xterm as unknown as { Terminal: typeof import("@xterm/headless").Terminal };

const ECHO = "terminal-apps/echo";
const APP_ID = "app:apps/terminal-browser:dev-1";
const SHELL_EXTENSION = "@workspace-extensions/shell";

const SOURCE_TREE = {
  children: [
    {
      name: "terminal-apps",
      path: "terminal-apps",
      isUnit: false,
      children: [
        {
          name: "echo",
          path: ECHO,
          isUnit: true,
          launchable: {
            type: "app",
            title: "Echo",
            description: "Echoes what you type.",
            icon: "🔊",
          },
          children: [],
        },
        {
          name: "pictures",
          path: "terminal-apps/pictures",
          isUnit: true,
          launchable: { type: "app", title: "Pictures", icon: "./assets/icon.svg" },
          children: [],
        },
      ],
    },
    {
      name: "panels",
      path: "panels",
      isUnit: false,
      children: [
        {
          name: "notes",
          path: "panels/notes",
          isUnit: true,
          launchable: { type: "app", title: "Notes panel" },
          children: [],
        },
      ],
    },
  ],
};

/** The shown workspace as this device's session: the shell extension, the source tree, approvals. */
class FakeWorkspace {
  approvals: PendingApproval[] = [];
  readonly resolved: string[] = [];
  private approvalStream: ReadableStreamDefaultController<Uint8Array> | null = null;

  constructor(readonly shell: FakeShell) {}

  emitApprovalsChanged(): void {
    this.approvalStream?.enqueue(
      encodeEventWatchRecord({
        kind: "event",
        event: "shell-approval:pending-changed",
        payload: {},
        sequence: 1,
      })
    );
  }

  rpc(): RpcClient {
    const shell = this.shell as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
    const call = async (target: string, method: { name: string }, args: unknown[]) => {
      expect(target).toBe("main");
      switch (method.name) {
        case "extensions.streamingMethods":
          expect(args[0]).toBe(SHELL_EXTENSION);
          return ["attach", "watchSessionInfo", "watchAllSessionInfo"];
        case "extensions.invoke": {
          const [name, shellMethod, shellArgs] = args as [string, string, unknown[]];
          expect(name).toBe(SHELL_EXTENSION);
          return shell[shellMethod]!.call(this.shell, ...shellArgs);
        }
        case "workspace.sourceTree":
          return SOURCE_TREE;
        case "shellApproval.listPending":
          return this.approvals;
        case "shellApproval.resolve":
          this.resolved.push(String(args[0]));
          this.approvals = this.approvals.filter((a) => a.approvalId !== args[0]);
          return undefined;
      }
      throw new Error(`unexpected workspace call ${method.name}`);
    };
    const stream = async (_target: string, method: { name: string }, args: unknown[]) => {
      if (method.name === "events.watch") {
        return new Response(
          new ReadableStream<Uint8Array>({
            start: (controller) => {
              this.approvalStream = controller;
              controller.enqueue(
                encodeEventWatchRecord({ kind: "watching", events: args[0] as never, epoch: "e" })
              );
            },
          })
        );
      }
      if (method.name === "extensions.invokeStream") {
        const [, shellMethod, shellArgs] = args as [string, string, unknown[]];
        expect(shellMethod).toBe("attach");
        return this.shell.attach(...(shellArgs as Parameters<FakeShell["attach"]>));
      }
      throw new Error(`unexpected workspace stream ${method.name}`);
    };
    return { call, stream, selfId: "shell:dev-1" } as unknown as RpcClient;
  }
}

/** The browser's System connection: it calls nothing there itself (settings go through the service). */
const systemRpc = {
  call: async (_target: string, method: { name: string }) => {
    throw new Error(`unexpected System call ${method.name}`);
  },
  stream: async (_target: string, method: { name: string }) => {
    throw new Error(`unexpected System stream ${method.name}`);
  },
  selfId: APP_ID,
} as unknown as RpcClient;

class FakeTty {
  readonly stdin = Object.assign(new EventEmitter(), {
    isTTY: true,
    rawModes: [] as boolean[],
    setRawMode(mode: boolean) {
      this.rawModes.push(mode);
      return this;
    },
    resume() {
      return this;
    },
    pause() {
      return this;
    },
  });
  readonly screen = new Terminal({ cols: 100, rows: 20, allowProposedApi: true });
  readonly written: string[] = [];
  readonly stdout = Object.assign(new EventEmitter(), {
    isTTY: true,
    columns: 100,
    rows: 20,
    write: (data: string) => {
      this.written.push(data);
      this.screen.write(data);
      return true;
    },
  });

  text(): string {
    const lines: string[] = [];
    const buffer = this.screen.buffer.active;
    for (let y = 0; y < this.screen.rows; y++)
      lines.push(buffer.getLine(buffer.viewportY + y)?.translateToString(true) ?? "");
    return lines.join("\n");
  }

  tabs(): string {
    return this.text().split("\n")[0]!;
  }

  type(data: string): void {
    this.stdin.emit("data", Buffer.from(data));
  }

  /** A left click at a 0-based screen cell (SGR mouse report). */
  click(x: number, y: number): void {
    this.type(`\x1b[<0;${x + 1};${y + 1}M\x1b[<0;${x + 1};${y + 1}m`);
  }
}

let currentScreen: (() => string) | null = null;
async function until(predicate: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 400; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`timed out waiting for ${what}; screen:\n${currentScreen?.() ?? ""}`);
}

const PREFIX = "\x00";

function setup(prepare?: (sessions: FakeTerminalSessions) => void) {
  const shell = new FakeShell();
  const sessions = new FakeTerminalSessions(shell, { [ECHO]: { title: "Echo", icon: "🔊" } });
  prepare?.(sessions);
  const workspace = new FakeWorkspace(shell);
  const tty = new FakeTty();
  currentScreen = () => tty.text();
  let connection: TerminalServerConnectionState = { phase: "connected" };
  const listeners = new Set<(state: TerminalServerConnectionState) => void>();
  const opened: string[] = [];
  const host: TerminalBrowserHost = {
    contractVersion: 2,
    rpc: systemRpc,
    appId: APP_ID,
    system: { id: "ws-system", name: "System" },
    workspace: { id: "ws-1", name: "Personal" },
    workspaceRpc: workspace.rpc(),
    server: { kind: "attached", endpoint: "http://127.0.0.1:1234" },
    stdin: tty.stdin as unknown as NodeJS.ReadStream,
    stdout: tty.stdout as unknown as NodeJS.WriteStream,
    connectionState: () => connection,
    onConnectionState: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    listWorkspaces: async () => [
      { id: "ws-1", name: "Personal" },
      { id: "ws-2", name: "Team" },
    ],
    openExternal: async (url) => {
      opened.push(url);
    },
    readLocalFile: async () => {
      throw new Error("the browser never reads local files");
    },
  };
  let exit: TerminalBrowserExit | null = null;
  const done = new TerminalBrowser(host, { sessions, settings: sessions }).run().then((result) => {
    exit = result;
    return result;
  });
  /** The PTY of the most recently active session. */
  const latestPty = () => {
    const newest = [...sessions.entries.values()].sort((a, b) => b.lastActiveAt - a.lastActiveAt)[0];
    return newest!.shellSessionId!;
  };
  return {
    shell,
    sessions,
    workspace,
    tty,
    done,
    opened,
    latestPty,
    exit: () => exit,
    setConnection(state: TerminalServerConnectionState) {
      connection = state;
      for (const listener of [...listeners]) listener(state);
    },
  };
}

type App = ReturnType<typeof setup>;

describe("terminal browser", () => {
  const running: App[] = [];
  const start = (prepare?: (sessions: FakeTerminalSessions) => void) => {
    const app = setup(prepare);
    running.push(app);
    return app;
  };
  afterEach(async () => {
    for (const app of running.splice(0)) {
      if (!app.exit()) app.tty.type(`${PREFIX}q`);
      await app.done.catch(() => {});
    }
  });

  /** Start Echo from the launcher and wait until its tab is attached. */
  async function startEcho(app: App): Promise<string> {
    await until(() => app.tty.text().includes("Echoes what you type."), "launcher");
    app.tty.type("ech\r");
    await until(() => app.tty.tabs().includes("1:🔊 Echo"), "Echo tab");
    const pty = app.latestPty();
    await until(() => app.shell.pty(pty).streams.size === 1, "attached");
    return pty;
  }

  async function startShell(app: App, tab: number): Promise<void> {
    app.tty.type(`${PREFIX}c`);
    await until(() => app.tty.text().includes("Your login shell"), "launcher");
    app.tty.type("shell\r");
    await until(() => app.tty.tabs().includes(`${tab}:Shell`), "Shell tab");
  }

  it("lists Shell and the workspace's terminal apps, and starts an app through the launch service", async () => {
    const app = start();
    const { tty, shell, sessions } = app;
    await until(() => tty.text().includes("what would you like to open?"), "launcher");
    const screen = tty.text();
    expect(screen).toContain("Start");
    expect(screen).toContain("Shell");
    expect(screen).toContain("Your login shell in Personal");
    expect(screen).toContain("🔊 Echo");
    expect(screen).toContain("Pictures");
    expect(screen).not.toContain("./assets/icon.svg"); // asset icons are not drawn
    expect(screen).not.toContain("Notes panel");
    expect(screen).not.toContain("Resume");
    const pty = await startEcho(app);
    expect(sessions.launches).toEqual([
      { source: ECHO, cols: 100, rows: 18, approvalsKey: "Ctrl-Space a" },
    ]);
    shell.emit(pty, "echo is ready");
    await until(() => tty.text().includes("echo is ready"), "program output");
    tty.type("abc\x01\x0c");
    await until(() => shell.typed(pty) === "abc\x01\x0c", "every key but the prefix reaches the program");
  });

  it("opens the person's login shell from the Shell entry", async () => {
    const app = start();
    await until(() => app.tty.text().includes("Your login shell"), "launcher");
    app.tty.type("shell\r");
    await until(() => app.tty.tabs().includes("1:Shell"), "Shell tab");
    expect(app.sessions.launches).toEqual([{ cols: 100, rows: 18, approvalsKey: "Ctrl-Space a" }]);
  });

  it("says plainly when this server cannot start terminal apps", async () => {
    const app = start();
    app.sessions.failure = new TerminalServiceUnavailableError(
      "this Vibestudio server has no terminal launch service. Update Vibestudio, then try again."
    );
    await until(() => app.tty.text().includes("Echoes what you type."), "launcher");
    app.tty.type("ech\r");
    await until(
      () => app.tty.text().includes("Terminal apps can't be started in Personal: this Vibestudio"),
      "actionable error"
    );
  });

  it("resumes the most recently active running session on start and lists the rest", async () => {
    let exited!: TerminalSessionEntry;
    const app = start((sessions) => {
      const logs = sessions.add({ title: "Logs" });
      exited = sessions.add({ title: "Old echo", kind: "app", source: ECHO, running: false });
      sessions.shell.exit(exited.shellSessionId!, 1);
      sessions.entries.set(exited.sessionId, { ...exited, exit: { code: 1 } });
      sessions.add({ title: "Build" });
      sessions.entries.set(logs.sessionId, { ...logs, lastActiveAt: 1 });
    });
    const { tty, shell } = app;
    await until(() => tty.tabs().includes("1:Build"), "auto-resume");
    await until(() => tty.text().includes("Resumed Build · 2 more in the launcher"), "notice");
    tty.type(`${PREFIX}c`);
    await until(() => tty.text().includes("🔊 Old echo"), "resume list");
    expect(tty.text()).toContain("exited (code 1)");
    expect(tty.text().indexOf("Old echo")).toBeLessThan(tty.text().indexOf("Logs"));
    tty.type("old\r");
    await until(() => tty.tabs().includes("2:🔊 Old echo"), "relaunched tab");
    const entry = app.sessions.entries.get(exited.sessionId)!;
    expect(entry.running).toBe(true);
    expect(entry.shellSessionId).not.toBe(exited.shellSessionId);
    await until(() => shell.pty(entry.shellSessionId!).streams.size === 1, "attached to new PTY");
  });

  it("detaches without ending the program and attaches it again from Resume", async () => {
    const app = start();
    const pty = await startEcho(app);
    app.shell.emit(pty, "kept output");
    await until(() => app.tty.text().includes("kept output"), "output");
    app.tty.type(`${PREFIX}d`);
    await until(() => app.tty.text().includes("Detached Echo; it keeps running"), "detached");
    expect(app.sessions.closed).toEqual([]);
    expect(app.shell.pty(pty).streams.size).toBe(0);
    await until(() => app.tty.text().includes("Resume"), "listed for resume");
    app.tty.type("\r");
    await until(() => app.tty.tabs().includes("1:🔊 Echo"), "tab again");
    await until(() => app.tty.text().includes("kept output"), "replayed output");
    expect(app.shell.attachCalls.at(-1)!.options).toEqual({ size: { cols: 100, rows: 18 } });
  });

  it("shows program titles, badges background attention and passes OSC 52 to the clipboard", async () => {
    const app = start();
    const echo = await startEcho(app);
    await startShell(app, 2);
    app.shell.emit(echo, "\x1b]2;Echo: build\x07");
    await until(() => app.tty.tabs().includes("1:🔊 Echo: build"), "OSC 2 title");
    app.shell.emit(echo, "\x1b]9;build finished\x07");
    await until(() => app.tty.tabs().includes("●"), "attention badge");
    app.tty.type(`${PREFIX}1`);
    await until(() => !app.tty.tabs().includes("●"), "badge cleared on focus");
    const payload = Buffer.from("hi").toString("base64");
    app.shell.emit(echo, `\x1b]52;c;${payload}\x07`);
    await until(() => app.tty.text().includes("Copied 2 characters from Echo: build"), "copy notice");
    expect(app.tty.written.join("")).toContain(`\x1b]52;c;${payload}\x07`);
  });

  it("opens a program's OSC 8 link only after the person confirms", async () => {
    const app = start();
    const pty = await startEcho(app);
    app.shell.emit(pty, "see \x1b]8;;https://docs.example.com/guide\x07the docs\x1b]8;;\x07\r\n");
    await until(() => app.tty.text().includes("see the docs"), "link drawn");
    app.tty.click(6, 1); // the session area starts below the tab strip
    await until(() => app.tty.text().includes("Open a link from Echo?"), "confirmation");
    expect(app.tty.text()).toContain("https://docs.example.com/guide");
    expect(app.opened).toEqual([]);
    app.tty.type("o");
    await until(() => app.opened.length === 1, "opened");
    expect(app.opened).toEqual(["https://docs.example.com/guide"]);
    await until(() => app.tty.text().includes("Opened docs.example.com in your browser"), "notice");

    app.tty.type(`${PREFIX}o`);
    await until(() => app.tty.text().includes("Links in Echo"), "links list");
    app.tty.type("\r");
    await until(() => app.tty.text().includes("Open a link from Echo?"), "confirmation again");
    app.tty.type("\x1b");
    await until(() => !app.tty.text().includes("Open a link from Echo?"), "cancelled");
    expect(app.opened).toHaveLength(1);
  });

  it("keeps an ended program's tab with its output and starts it again on prefix r", async () => {
    const app = start();
    const pty = await startEcho(app);
    app.shell.emit(pty, "last words");
    const entry = [...app.sessions.entries.values()][0]!;
    app.sessions.exit(entry.sessionId, 3);
    await until(() => app.tty.text().includes("Echo exited (code 3)"), "ended state");
    expect(app.tty.text()).toContain("last words");
    expect(app.tty.text()).toContain("Ctrl-Space r start it again");
    app.tty.type(`${PREFIX}r`);
    await until(() => app.sessions.entries.get(entry.sessionId)!.running, "relaunched");
    const relaunched = app.sessions.entries.get(entry.sessionId)!.shellSessionId!;
    await until(() => app.shell.pty(relaunched).streams.size === 1, "attached to the new PTY");
    await until(() => !app.tty.text().includes("exited (code 3)"), "live again");
  });

  it("closes a tab whose session was ended elsewhere, and ends one for good on prefix x", async () => {
    const app = start();
    await startEcho(app);
    await startShell(app, 2);
    const [echo, shellEntry] = [...app.sessions.entries.values()];
    app.sessions.remove(echo!.sessionId);
    await until(() => app.tty.text().includes("Echo was ended"), "ended elsewhere");
    expect(app.tty.tabs()).not.toContain("Echo");
    app.tty.type(`${PREFIX}x`);
    await until(() => app.tty.text().includes("End Shell?"), "confirmation");
    expect(app.tty.text()).toContain("The program is stopped");
    app.tty.type("y");
    await until(() => app.sessions.closed.includes(shellEntry!.sessionId), "closed");
    await until(() => app.tty.text().includes("what would you like to open?"), "launcher");
  });

  it("reattaches after a lost connection, resuming after the last byte it received", async () => {
    const app = start();
    const pty = await startEcho(app);
    app.shell.emit(pty, "before ");
    await until(() => app.tty.text().includes("before"), "output");
    app.setConnection({ phase: "reconnecting", cause: "socket closed" });
    app.shell.dropAttachments();
    await until(() => app.tty.text().includes("Reconnecting to the server…"), "reconnecting");
    app.shell.emit(pty, "after");
    app.setConnection({ phase: "connected" });
    await until(() => app.tty.text().includes("before after"), "caught up");
    expect(app.shell.attachCalls.at(-1)!.options).toEqual({
      after: { epoch: 1, cursor: 7 },
      size: { cols: 100, rows: 18 },
    });
  });

  it("opens approvals by itself for the app in the focused tab and decides with a digit", async () => {
    const app = start();
    await startEcho(app);
    const entry = [...app.sessions.entries.values()][0]!;
    app.workspace.approvals = [
      {
        kind: "capability",
        approvalId: "a1",
        callerId: entry.principalId!,
        callerKind: "panel",
        repoPath: ECHO,
        effectiveVersion: "ev",
        requestedAt: 1,
        capability: "server-logs.read",
        title: "Read server logs",
      },
    ];
    app.workspace.emitApprovalsChanged();
    await until(() => app.tty.text().includes("Approvals (1)"), "approvals overlay");
    expect(app.tty.text()).toContain("requested by Echo (this tab)");
    app.tty.type("1");
    await until(() => app.workspace.resolved.includes("a1"), "decision");
    await until(() => !app.tty.text().includes("Approvals (1)"), "overlay closes when queue empties");
  });

  it("returns to the launcher when an overlay closes with nothing open", async () => {
    const { tty } = start();
    await until(() => tty.text().includes("what would you like to open?"), "launcher");
    tty.type(`${PREFIX}?`);
    await until(() => tty.text().includes("Every key goes to the session"), "help");
    expect(tty.text()).toContain("Ctrl-Space o");
    tty.type("\x1b");
    await until(() => tty.text().includes("what would you like to open?"), "launcher again");
  });

  it("quits with the terminal restored", async () => {
    const app = start();
    await until(() => app.tty.text().includes("Echo"), "launcher");
    app.tty.type(`${PREFIX}q`);
    await expect(app.done).resolves.toEqual({ kind: "quit" });
    const output = app.tty.written.join("");
    expect(output).toContain("\x1b[?1049h");
    expect(output.endsWith("\x1b[?1049l")).toBe(true);
    expect(app.tty.stdin.rawModes).toEqual([true, false]);
  });

  it("switches workspace through the workspace list", async () => {
    const app = start();
    await until(() => app.tty.text().includes("Echo"), "launcher");
    app.tty.type(`${PREFIX}w`);
    await until(
      () => app.tty.text().includes("Switch workspace") && app.tty.text().includes("Team"),
      "workspaces"
    );
    app.tty.type("tea\r");
    await expect(app.done).resolves.toEqual({ kind: "switch-workspace", workspaceId: "ws-2" });
  });

  it("ends with the cause when the connection is lost", async () => {
    const app = start();
    await until(() => app.tty.text().includes("Echo"), "launcher");
    app.setConnection({ phase: "reconnecting", cause: "socket closed" });
    await until(() => app.tty.text().includes("reconnecting (socket closed)"), "reconnecting");
    app.setConnection({ phase: "lost", cause: "credential revoked" });
    await expect(app.done).resolves.toEqual({ kind: "connection-lost", cause: "credential revoked" });
  });

  it("persists a changed prefix key and uses it at once", async () => {
    const { tty, sessions } = start();
    await until(() => tty.text().includes("Echo"), "launcher");
    tty.type(`${PREFIX}s`);
    await until(() => tty.text().includes("Prefix key"), "settings");
    tty.type("\x1b[C"); // right: next prefix
    await until(() => sessions.settings["prefixKey"] === "C-a", "saved");
    tty.type("\x1b");
    tty.type("\x01?");
    await until(() => tty.text().includes("Every key goes to the session"), "help via new prefix");
    tty.type("\x1b");
    tty.type("\x01q");
  });

  it("refuses to run without a terminal", async () => {
    const tty = new FakeTty();
    (tty.stdout as { isTTY: boolean }).isTTY = false;
    const host = {
      contractVersion: 2,
      rpc: systemRpc,
      appId: APP_ID,
      system: { id: "ws-system", name: "System" },
      workspace: { id: "ws", name: "Personal" },
      workspaceRpc: new FakeWorkspace(new FakeShell()).rpc(),
      server: { kind: "attached", endpoint: "x" },
      stdin: tty.stdin,
      stdout: tty.stdout,
      connectionState: () => ({ phase: "connected" }),
      onConnectionState: () => () => {},
      listWorkspaces: vi.fn(),
      openExternal: vi.fn(),
      readLocalFile: vi.fn(),
    } as unknown as TerminalBrowserHost;
    await expect(run(host)).rejects.toThrow(/interactive terminal/);
    expect(tty.written).toEqual([]);
  });
});
