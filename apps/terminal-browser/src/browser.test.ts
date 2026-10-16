import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import xterm from "@xterm/headless";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import type { RpcClient, RpcStreamOptions } from "@vibestudio/rpc";
import { schemaRpcClientMock } from "@vibestudio/rpc/test-utils";
import type { PendingApproval } from "@vibestudio/shared/approvals";
import { encodeEventWatchRecord } from "@vibestudio/shared/events";
import type {
  TerminalBrowserExit,
  TerminalBrowserHost,
  TerminalServerConnectionState,
} from "@vibestudio/shell-core/terminal/terminalBrowserHost";
import { TERMINAL_BROWSER_HOST_CONTRACT_VERSION } from "@vibestudio/shell-core/terminal/terminalBrowserHost";
import { TerminalBrowser } from "./browser.js";
import { run } from "./index.js";
import type { TerminalSessionEntry } from "./sessions/launcher.js";
import { FakeShell, FakeTerminalSessions } from "./testing/fakeShell.js";

const { Terminal } = xterm as unknown as {
  Terminal: typeof import("@xterm/headless").Terminal;
};

function withUnicode11<T extends InstanceType<typeof Terminal>>(terminal: T): T {
  terminal.loadAddon(new Unicode11Addon());
  terminal.unicode.activeVersion = "11";
  return terminal;
}

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
          launchable: {
            type: "app",
            title: "Pictures",
            icon: "./assets/icon.svg",
          },
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
  admitApprovalWatch?: () => Promise<void>;
  readApprovals?: () => Promise<PendingApproval[]>;
  /** `approvalId:decision` per resolve call. */
  readonly resolved: string[] = [];
  readonly submitted: Array<{
    method: string;
    id: string;
    values: Record<string, string>;
  }> = [];
  private approvalStream: ReadableStreamDefaultController<Uint8Array> | null = null;
  private approvalSequence = 0;

  constructor(readonly shell: FakeShell) {}

  emitApprovalsChanged(): void {
    this.approvalStream?.enqueue(
      encodeEventWatchRecord({
        kind: "event",
        event: "shell-approval:pending-changed",
        payload: {},
        sequence: ++this.approvalSequence,
      })
    );
  }

  rpc(): RpcClient {
    const shell = this.shell as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
    const call = async (target: string, method: string, args: unknown[]) => {
      expect(target).toBe("main");
      switch (method) {
        case "extensions.streamingMethods":
          expect(args[0]).toBe(SHELL_EXTENSION);
          return ["attach", "watchSessionInfo", "watchAllSessionInfo"];
        case "extensions.invoke": {
          const [name, shellMethod, shellArgs] = args as [string, string, unknown[]];
          expect(name).toBe(SHELL_EXTENSION);
          // The public extensions.invoke service represents command-style
          // undefined results as JSON null, exactly as its real handler does.
          return (await shell[shellMethod]!.call(this.shell, ...shellArgs)) ?? null;
        }
        case "workspace.sourceTree":
          return SOURCE_TREE;
        case "shellApproval.listPending":
          return this.readApprovals ? this.readApprovals() : this.approvals;
        case "shellApproval.resolve":
          this.resolved.push(`${String(args[0])}:${String(args[1])}`);
          this.approvals = this.approvals.filter((a) => a.approvalId !== args[0]);
          return undefined;
        case "shellApproval.submitSecretInput":
        case "shellApproval.submitCredentialInput":
        case "shellApproval.submitClientConfig":
          this.submitted.push({
            method,
            id: args[0] as string,
            values: args[1] as Record<string, string>,
          });
          this.approvals = this.approvals.filter((approval) => approval.approvalId !== args[0]);
          return undefined;
      }
      throw new Error(`unexpected workspace call ${method}`);
    };
    const stream = async (
      _target: string,
      method: string,
      args: unknown[],
      options?: RpcStreamOptions
    ) => {
      if (method === "events.watch") {
        if ((args[0] as string[]).includes("shell-approval:pending-changed"))
          await this.admitApprovalWatch?.();
        let stop: () => void = () => {};
        return new Response(
          new ReadableStream<Uint8Array>({
            start: (controller) => {
              const signal = options?.signal;
              const abort = () => {
                stop();
                controller.error(signal!.reason);
              };
              stop = () => {
                signal?.removeEventListener("abort", abort);
                if (this.approvalStream === controller) this.approvalStream = null;
              };
              if (signal?.aborted) {
                abort();
                return;
              }
              signal?.addEventListener("abort", abort, { once: true });
              const events = args[0] as string[];
              if (!events.includes("workspace:units-changed")) this.approvalStream = controller;
              controller.enqueue(
                encodeEventWatchRecord({
                  kind: "watching",
                  events: args[0] as never,
                  epoch: "e",
                })
              );
            },
            cancel: () => stop(),
          })
        );
      }
      if (method === "extensions.invokeStream") {
        const [, shellMethod, shellArgs] = args as [string, string, unknown[]];
        expect(shellMethod).toBe("attach");
        return this.shell.attach(...(shellArgs as Parameters<FakeShell["attach"]>));
      }
      throw new Error(`unexpected workspace stream ${method}`);
    };
    return schemaRpcClientMock(
      {
        call,
        stream,
        streamReadable: async (...args) => {
          const response = await stream(...args);
          return {
            status: response.status,
            statusText: response.statusText,
            headers: [...response.headers.entries()],
            finalUrl: response.url,
            body: response.body!,
          };
        },
      },
      "shell:dev-1"
    );
  }
}

/** The browser's System connection: it calls nothing there itself (settings go through the service). */
const systemRpc = schemaRpcClientMock(
  {
    call: async (_target: string, method: string) => {
      throw new Error(`unexpected System call ${method}`);
    },
    stream: async (_target: string, method: string) => {
      throw new Error(`unexpected System stream ${method}`);
    },
  },
  APP_ID
);

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
  // The person's terminal, measuring text as current terminals do (emoji take two cells).
  readonly screen = withUnicode11(
    new Terminal({
      cols: 100,
      rows: 20,
      allowProposedApi: true,
    })
  );
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

  /** The left button goes down at one cell and comes up at another (a drag off a button). */
  pressAndRelease(from: { x: number; y: number }, to: { x: number; y: number }): void {
    this.type(`\x1b[<0;${from.x + 1};${from.y + 1}M\x1b[<0;${to.x + 1};${to.y + 1}m`);
  }

  /** The cell where `text` starts on screen (first occurrence). */
  find(text: string): { x: number; y: number } {
    const lines = this.text().split("\n");
    const y = lines.findIndex((line) => line.includes(text));
    if (y === -1) throw new Error(`"${text}" is not on screen:\n${this.text()}`);
    return { x: lines[y]!.indexOf(text), y };
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

const PREFIX = "\x02";

function setup(
  prepare?: (sessions: FakeTerminalSessions) => void,
  prepareWorkspace?: (workspace: FakeWorkspace) => void
) {
  const shell = new FakeShell();
  const sessions = new FakeTerminalSessions(shell, {
    [ECHO]: { title: "Echo", icon: "🔊" },
  });
  prepare?.(sessions);
  const workspace = new FakeWorkspace(shell);
  prepareWorkspace?.(workspace);
  const tty = new FakeTty();
  currentScreen = () => tty.text();
  let connection: TerminalServerConnectionState = { phase: "connected" };
  const listeners = new Set<(state: TerminalServerConnectionState) => void>();
  const opened: string[] = [];
  const cancellation = new AbortController();
  const host: TerminalBrowserHost = {
    contractVersion: TERMINAL_BROWSER_HOST_CONTRACT_VERSION,
    signal: cancellation.signal,
    files: { upload: vi.fn(), download: vi.fn(), saveText: vi.fn() },
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
  };
  let exit: TerminalBrowserExit | null = null;
  const done = new TerminalBrowser(host, { sessions, settings: sessions }).run().then((result) => {
    exit = result;
    return result;
  });
  /** The PTY of the most recently active session. */
  const latestPty = () => {
    const newest = [...sessions.entries.values()].sort(
      (a, b) => b.lastActiveAt - a.lastActiveAt
    )[0];
    return newest!.shellSessionId!;
  };
  return {
    shell,
    sessions,
    workspace,
    tty,
    done,
    opened,
    files: host.files,
    cancellation,
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
  const start = (
    prepare?: (sessions: FakeTerminalSessions) => void,
    prepareWorkspace?: (workspace: FakeWorkspace) => void
  ) => {
    const app = setup(prepare, prepareWorkspace);
    running.push(app);
    return app;
  };
  afterEach(async () => {
    for (const app of running.splice(0)) {
      if (!app.exit()) app.tty.type(`${PREFIX}q`);
      if (!app.exit()) app.cancellation.abort(new Error("Test cleanup"));
      await app.done.catch(() => {});
    }
  });

  it("loads saved settings before admitting edits instead of replacing unknown preferences", async () => {
    let complete!: (settings: Record<string, unknown>) => void;
    const app = start((sessions) => {
      vi.spyOn(sessions, "getSettings").mockImplementation(
        () =>
          new Promise((resolve) => {
            complete = resolve;
          })
      );
    });
    try {
      await until(() => app.tty.text().includes("Echo"), "launcher while settings load");
      app.tty.type(`${PREFIX}s\x1b[C`);
      await until(() => app.tty.text().includes("still loading"), "edit readiness notice");
      expect(app.sessions.settings).toEqual({});
      complete({ prefixKey: "C-a", autoOpenApprovals: false });
      await until(() => app.tty.text().includes("Ctrl-A"), "saved preferences");
      app.tty.type("\x1b[C");
      await until(() => app.sessions.settings["prefixKey"] === "C-b", "new settings saved");
      expect(app.sessions.settings["autoOpenApprovals"]).toBe(false);
    } finally {
      complete({ prefixKey: "C-a", autoOpenApprovals: false });
    }
  });

  it("serializes complete settings replacements while allowing immediate local edits", async () => {
    let release!: () => void;
    const app = start((sessions) => {
      vi.spyOn(sessions, "setSettings").mockImplementationOnce(async (settings) => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        sessions.settings = settings;
      });
    });
    await until(() => app.tty.text().includes("Echo"), "loaded launcher");
    app.tty.type(`${PREFIX}s\x1b[C\x1b[C`);
    await until(() => !!release, "first settings write");
    try {
      await new Promise((resolve) => setImmediate(resolve));
      expect(vi.mocked(app.sessions.setSettings)).toHaveBeenCalledTimes(1);
    } finally {
      release();
    }
    await until(() => app.sessions.settings["prefixKey"] === "C-\\", "ordered final settings");
    expect(vi.mocked(app.sessions.setSettings)).toHaveBeenCalledTimes(2);
  });

  it("never transfers selected consent when the queue reorders or removes that request", async () => {
    const app = start();
    await startEcho(app);
    const entry = [...app.sessions.entries.values()][0]!;
    const request = (id: string): PendingApproval => ({
      kind: "capability",
      approvalId: id,
      callerId: entry.principalId!,
      callerKind: "app",
      repoPath: ECHO,
      effectiveVersion: "ev",
      requestedAt: 1,
      capability: "server-logs.read",
      title: `Read logs ${id}`,
    });
    const first = request("first");
    const second = request("second");
    app.workspace.approvals = [first, second];
    app.workspace.emitApprovalsChanged();
    await until(() => app.tty.text().includes("Approvals (2)"), "selected first request");
    app.workspace.approvals = [second, first];
    app.workspace.emitApprovalsChanged();
    await until(() => app.tty.text().includes("2. Read logs first"), "reordered queue");
    app.tty.type("1");
    await until(() => app.workspace.resolved.includes("first:once"), "original selected decision");
    await until(
      () => app.tty.text().includes("selected request ended"),
      "removed selection explanation"
    );
    app.tty.type("1");
    await new Promise((resolve) => setImmediate(resolve));
    expect(app.workspace.resolved).toEqual(["first:once"]);
    app.tty.type("\x1b[B1");
    await until(
      () => app.workspace.resolved.includes("second:once"),
      "explicit replacement selection"
    );
  });

  it("names an approval no tab owns in the status bar without taking the keyboard", async () => {
    const app = start();
    const pty = await startEcho(app);
    app.workspace.approvals = [
      {
        kind: "capability",
        approvalId: "workspace",
        callerId: "worker:somewhere-else",
        callerKind: "worker",
        repoPath: "workers/elsewhere",
        effectiveVersion: "ev",
        requestedAt: 1,
        capability: "server-logs.read",
        title: "Read logs",
      },
    ];
    app.workspace.emitApprovalsChanged();
    await until(
      () =>
        app.tty.text().split("\n").at(-1)!.includes("Approval needed — press Ctrl-B a · Read logs"),
      "status bar approval"
    );
    expect(app.tty.text()).not.toContain("Approvals (1)");
    app.tty.type("1");
    await until(() => app.shell.typed(pty) === "1", "keys still reach the tab");
    expect(app.workspace.resolved).toEqual([]);
    app.tty.click(4, 19);
    await until(() => app.tty.text().includes("Approvals (1)"), "status bar click opens approvals");
  });

  it("blocks hidden approval decisions and session bytes below usable size", async () => {
    const app = start();
    const pty = await startEcho(app);
    const entry = [...app.sessions.entries.values()][0]!;
    app.workspace.approvals = [
      {
        kind: "capability",
        approvalId: "narrow",
        callerId: entry.principalId!,
        callerKind: "app",
        repoPath: ECHO,
        effectiveVersion: "ev",
        requestedAt: 1,
        capability: "server-logs.read",
        title: "Read logs",
      },
    ];
    app.workspace.emitApprovalsChanged();
    await until(() => app.tty.text().includes("Approvals (1)"), "approval");
    app.tty.stdout.columns = 30;
    app.tty.stdout.emit("resize");
    app.tty.type("1text");
    await new Promise((resolve) => setImmediate(resolve));
    expect(app.workspace.resolved).toEqual([]);
    expect(app.shell.typed(pty)).toBe("");
    app.tty.stdout.columns = 100;
    app.tty.stdout.rows = 8;
    app.tty.stdout.emit("resize");
    app.tty.type("1");
    await new Promise((resolve) => setImmediate(resolve));
    expect(app.workspace.resolved).toEqual([]);
    app.tty.type("\x07");
    app.tty.stdout.rows = 20;
    app.tty.stdout.emit("resize");
    app.tty.type(`${PREFIX}a`);
    await until(() => app.tty.text().includes("Approvals (1)"), "visible again");
    app.tty.type("1");
    await until(() => app.workspace.resolved.length === 1, "visible decision");
  });

  it("reserves migrated Ctrl-G and cancels armed-prefix modal, approval and protected-form focus", async () => {
    const app = start((sessions) => {
      sessions.settings = { prefixKey: "C-g" };
    });
    const pty = await startEcho(app);
    const cancelFragmented = () => {
      app.tty.type(`${PREFIX}\x1b`);
      app.tty.type("\x07");
    };
    app.tty.type(`${PREFIX}s`);
    await until(() => app.tty.text().includes("Settings"), "settings modal");
    cancelFragmented();
    await until(() => !app.tty.text().includes("Settings"), "cancel modal and prefix");
    app.tty.type("z");
    await until(() => app.shell.typed(pty) === "z", "following input is not poisoned");
    const entry = [...app.sessions.entries.values()][0]!;
    const common = {
      callerId: entry.principalId!,
      callerKind: "app" as const,
      repoPath: ECHO,
      effectiveVersion: "ev",
      requestedAt: 1,
    };
    app.workspace.approvals = [
      {
        ...common,
        kind: "capability",
        approvalId: "cancel-card",
        capability: "server-logs.read",
        title: "Read logs",
      },
    ];
    app.workspace.emitApprovalsChanged();
    await until(() => app.tty.text().includes("Approvals (1)"), "approval modal");
    cancelFragmented();
    await until(() => !app.tty.text().includes("Approvals (1)"), "approval focus cancelled");
    expect(app.workspace.resolved).toEqual([]);
    app.workspace.approvals = [
      {
        ...common,
        kind: "secret-input",
        approvalId: "cancel-form",
        title: "Protected form",
        fields: [{ name: "token", label: "Token", type: "secret", required: true }],
      },
    ];
    app.workspace.emitApprovalsChanged();
    await until(() => app.tty.text().includes("Protected form"), "form modal");
    app.tty.type("sensitive");
    cancelFragmented();
    await until(() => !app.tty.text().includes("Protected form"), "form focus cancelled");
    expect(app.workspace.submitted).toEqual([]);
    expect(app.shell.typed(pty)).toBe("z");
    app.tty.type(`${PREFIX}a`);
    await until(() => app.tty.text().includes("Protected form"), "form reopens");
    expect(app.tty.text()).not.toContain("•");
  });

  it("searches scrollback by cell coordinates and copies the complete match", async () => {
    const app = start();
    const pty = await startEcho(app);
    app.shell.emit(pty, "A界B needle\r\nnext line");
    await until(() => app.tty.text().includes("needle"), "output");
    app.tty.type(`${PREFIX}/needle\r`);
    await until(() => app.tty.text().includes("copy"), "search result in copy mode");
    app.tty.type("y");
    await until(
      () =>
        app.tty.written.some((bytes) => bytes.includes(Buffer.from("needle").toString("base64"))),
      "cell-aware match copied"
    );
  });

  it("submits protected secret values through the canonical form without painting or forwarding them", async () => {
    const app = start();
    const pty = await startEcho(app);
    const entry = [...app.sessions.entries.values()][0]!;
    app.workspace.approvals = [
      {
        kind: "secret-input",
        approvalId: "protected",
        callerId: entry.principalId!,
        callerKind: "app",
        repoPath: ECHO,
        effectiveVersion: "ev",
        requestedAt: 1,
        title: "Provide token",
        fields: [{ name: "token", label: "Token", required: true, type: "secret" }],
      },
    ];
    app.workspace.emitApprovalsChanged();
    await until(() => app.tty.text().includes("Provide token"), "protected input");
    app.tty.type("\x1b[200~sensitive-👩‍💻\x1b[201~");
    await until(() => app.tty.text().includes("•"), "masked value");
    expect(app.tty.text()).not.toContain("sensitive");
    expect(app.shell.typed(pty)).toBe("");
    app.tty.type("\r\r");
    await until(() => app.workspace.submitted.length === 1, "protected submission");
    expect(app.workspace.submitted).toEqual([
      {
        method: "shellApproval.submitSecretInput",
        id: "protected",
        values: { token: "sensitive-👩‍💻" },
      },
    ]);
    expect(app.tty.written.join("")).not.toContain("sensitive");
  });

  it("exports a full browser log through an explicit local path gesture", async () => {
    const app = start();
    await startEcho(app);
    vi.mocked(app.files.saveText).mockResolvedValue({
      path: "/chosen/log.txt",
      size: 123,
    });
    app.setConnection({
      phase: "reconnecting",
      cause: "long failure evidence",
    });
    app.setConnection({ phase: "connected" });
    app.tty.type(`${PREFIX}le`);
    await until(() => app.tty.text().includes("New local output path"), "explicit export prompt");
    app.tty.type("/chosen/log.txt\r\r");
    await until(() => vi.mocked(app.files.saveText).mock.calls.length === 1, "export");
    expect(vi.mocked(app.files.saveText).mock.calls[0]![0]).toMatchObject({
      localPath: "/chosen/log.txt",
      text: expect.stringContaining("long failure evidence"),
    });
  });

  it("uploads to the context selected when the file gesture opened, even after switching tabs", async () => {
    const app = start();
    await startEcho(app);
    const entry = [...app.sessions.entries.values()][0]!;
    app.sessions.update(entry.sessionId, { contextId: "echo-context" });
    await startShell(app, 2);
    app.tty.type(`${PREFIX}1${PREFIX}kupload\r`);
    await until(() => app.tty.text().includes("Local source path"), "upload gesture");
    app.tty.type(`${PREFIX}2`);
    vi.mocked(app.files.upload).mockResolvedValue({
      path: "uploads/notes.txt",
      size: 8,
    });
    app.tty.type("/local/notes.txt\ruploads/notes.txt\r");
    await until(
      () => app.tty.text().includes("Upload and replace workspace destination"),
      "explicit replacement confirmation"
    );
    expect(app.files.upload).not.toHaveBeenCalled();
    app.tty.type("\r");
    await until(() => vi.mocked(app.files.upload).mock.calls.length === 1, "context-bound upload");
    expect(vi.mocked(app.files.upload).mock.calls[0]![0]).toEqual({
      contextId: "echo-context",
      localPath: "/local/notes.txt",
      workspacePath: "uploads/notes.txt",
    });
    await until(
      () => app.tty.text().includes("/attach uploads/notes.txt"),
      "canonical attach instruction"
    );
  });

  it("signals and joins an explicitly cancelled file transfer before browser retirement", async () => {
    const app = start();
    await startEcho(app);
    let settle!: () => void;
    let transferSignal: AbortSignal | undefined;
    vi.mocked(app.files.download).mockImplementation((_input, options) => {
      transferSignal = options?.signal;
      return new Promise((_resolve, reject) => {
        settle = () => reject(transferSignal!.reason);
      });
    });
    app.tty.type(`${PREFIX}kdownload\r`);
    await until(() => app.tty.text().includes("Workspace source path"), "download gesture");
    app.tty.type("workspace/file.txt\r/local/new.txt\r\r");
    await until(() => !!settle, "transfer admitted");
    let retired = false;
    void app.done.then(() => {
      retired = true;
    });
    app.tty.type(`\x07${PREFIX}q`);
    try {
      await new Promise((resolve) => setImmediate(resolve));
      expect(transferSignal?.aborted).toBe(true);
      expect(retired).toBe(false);
    } finally {
      settle();
    }
    await app.done;
    expect(retired).toBe(true);
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
    await until(
      () => tty.text().includes("🔊 Echo") && tty.text().includes("Pictures"),
      "the launcher with its asynchronously loaded terminal app catalog"
    );
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
      { source: ECHO, cols: 100, rows: 18, approvalsKey: "Ctrl-B a" },
    ]);
    shell.emit(pty, "echo is ready");
    await until(() => tty.text().includes("echo is ready"), "program output");
    tty.type("abc\x01\x0c");
    await until(
      () => shell.typed(pty) === "abc\x01\x0c",
      "every key but the prefix reaches the program"
    );
  });

  it("opens the person's login shell from the Shell entry", async () => {
    const app = start();
    await until(() => app.tty.text().includes("Your login shell"), "launcher");
    app.tty.type("shell\r");
    await until(() => app.tty.tabs().includes("1:Shell"), "Shell tab");
    expect(app.sessions.launches).toEqual([{ cols: 100, rows: 18, approvalsKey: "Ctrl-B a" }]);
  });

  it("resumes the most recently active running session on start and lists the rest", async () => {
    let exited!: TerminalSessionEntry;
    const app = start((sessions) => {
      const logs = sessions.add({ title: "Logs" });
      exited = sessions.add({
        title: "Old echo",
        kind: "app",
        source: ECHO,
        running: false,
      });
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
    expect(app.shell.attachCalls.at(-1)!.options).toEqual({
      size: { cols: 100, rows: 18 },
    });
  });

  it("lists a detached session under Resume by the title its program last set", async () => {
    const app = start();
    const pty = await startEcho(app);
    app.shell.emit(pty, "\x1b]2;Five-Word Greeting\x07");
    await until(() => app.tty.tabs().includes("1:🔊 Five-Word Greeting"), "OSC 2 title");
    app.tty.type(`${PREFIX}d`);
    await until(() => app.tty.text().includes("Resume"), "listed for resume");
    const lines = app.tty.text().split("\n");
    const row = lines.findIndex((line) => line.includes("🔊 Five-Word Greeting"));
    expect(row).not.toBe(-1);
    // The app's own title stays in the row's detail.
    expect(lines[row + 1]).toContain("Echo · running");
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
    await until(
      () => app.tty.text().includes("Copied 2 characters from Echo: build"),
      "copy notice"
    );
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
    app.tty.type("\x1b[27u");
    await until(() => !app.tty.text().includes("Open a link from Echo?"), "cancelled");
    expect(app.opened).toHaveLength(1);
  });

  it("closes the tab of a program the person quit, back to the launcher", async () => {
    const app = start();
    await startEcho(app);
    const entry = [...app.sessions.entries.values()][0]!;
    app.sessions.exit(entry.sessionId, 0);
    await until(() => app.sessions.closed.includes(entry.sessionId), "session closed");
    await until(() => app.tty.text().includes("what would you like to open?"), "launcher");
    expect(app.tty.tabs()).not.toContain("Echo");
  });

  it("keeps an ended program's tab with its output and starts it again on prefix r", async () => {
    const app = start();
    const pty = await startEcho(app);
    app.shell.emit(pty, "last words");
    const entry = [...app.sessions.entries.values()][0]!;
    app.sessions.exit(entry.sessionId, 3);
    await until(() => app.tty.text().includes("Echo exited (code 3)"), "ended state");
    expect(app.tty.text()).toContain("last words");
    expect(app.tty.text()).toContain("Ctrl-B r start it again");
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

  it("retries a running session observation failure through canonical resume without relaunching its PTY", async () => {
    const app = start();
    const pty = await startEcho(app);
    const entry = [...app.sessions.entries.values()][0]!;
    app.sessions.update(entry.sessionId, {
      failure: "exit observation failed",
    });
    const resume = vi.spyOn(app.sessions, "resume").mockImplementation(async ({ sessionId }) => {
      const recovered = { ...app.sessions.entries.get(sessionId)! };
      delete recovered.failure;
      app.sessions.entries.set(sessionId, recovered);
      return recovered;
    });
    await until(
      () => app.tty.text().includes("exit observation failed"),
      "persistent observation warning"
    );
    app.tty.type(`${PREFIX}r`);
    await until(
      () => resume.mock.calls.length === 1 && !app.tty.text().includes("exit observation failed"),
      "authoritative observation retry"
    );
    expect(app.sessions.entries.get(entry.sessionId)!.shellSessionId).toBe(pty);
    expect(app.shell.attachCalls).toHaveLength(1);
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
    await until(() => app.workspace.resolved.includes("a1:once"), "decision");
    await until(
      () => !app.tty.text().includes("Approvals (1)"),
      "overlay closes when queue empties"
    );
  });

  it("attributes an approval raised by an agent the tab's app started, and numbers only its allowed decisions", async () => {
    const app = start();
    await startEcho(app);
    const entry = [...app.sessions.entries.values()][0]!;
    app.workspace.approvals = [
      {
        kind: "capability",
        approvalId: "a2",
        callerId: "do:agents/chat:ChatAgent:1",
        callerKind: "do",
        repoPath: "agents/chat",
        effectiveVersion: "ev",
        requestedAt: 1,
        capability: "native.shell.execute",
        title: "Run a command",
        cardType: "confirm.critical",
        allowedDecisions: ["once", "deny"],
        requester: {
          id: "do:agents/chat:ChatAgent:1",
          kind: "do",
          category: "agent",
          title: "Chat",
          repoPath: "agents/chat",
          effectiveVersion: "ev",
          stableIdentityKey: "agents/chat@ev",
          ephemeralInstanceKey: "do:agents/chat:ChatAgent:1",
          breadcrumbs: [
            {
              id: entry.principalId!,
              kind: "app",
              category: "workspace-app",
              label: "Echo",
            },
            {
              id: "do:agents/chat:ChatAgent:1",
              kind: "do",
              category: "agent",
              label: "Chat",
            },
          ],
        },
      },
    ];
    app.workspace.emitApprovalsChanged();
    await until(() => app.tty.text().includes("Approvals (1)"), "approvals overlay");
    expect(app.tty.text()).toContain("requested by Echo (this tab)");
    expect(app.tty.text()).toContain("[1] Confirm  [2] Cancel ");
    expect(app.tty.text()).not.toContain("[3]");
    app.tty.type("\x1b[27u");
    await until(() => app.tty.tabs().includes("!"), "badge on the tab");
    app.tty.type(`${PREFIX}a`);
    await until(() => app.tty.text().includes("Approvals (1)"), "approvals again");
    app.tty.type("2");
    await until(() => app.workspace.resolved.includes("a2:deny"), "denied");
  });

  it("opens a workspace review once this tab's work is parked on it, and badges the tab", async () => {
    const app = start();
    await startEcho(app);
    const entry = [...app.sessions.entries.values()][0]!;
    const welcome: PendingApproval = {
      kind: "unit-install-review",
      approvalId: "welcome",
      callerId: "system:units",
      callerKind: "system",
      repoPath: "meta",
      effectiveVersion: "",
      requestedAt: 1,
      mode: "adopt-root",
      title: "what's in your workspace",
      description: "Everything already in this workspace.",
      parts: [],
      summary: {
        panels: 0,
        agents: 0,
        services: 0,
        clientApps: 0,
        extensions: 0,
      },
      unchangedPartCount: 0,
    };
    app.workspace.approvals = [welcome];
    app.workspace.emitApprovalsChanged();
    await until(() => app.tty.text().includes("Approval needed"), "status bar approval");
    expect(app.tty.text()).not.toContain("Approvals (1)");
    expect(app.tty.tabs()).not.toContain("!");
    app.workspace.approvals = [
      {
        ...welcome,
        waiting: [
          {
            id: "do:agents/chat:ChatAgent:1",
            kind: "do",
            category: "agent",
            repoPath: "agents/chat",
            effectiveVersion: "ev",
            stableIdentityKey: "agents/chat@ev",
            ephemeralInstanceKey: "do:agents/chat:ChatAgent:1",
            breadcrumbs: [
              {
                id: entry.principalId!,
                kind: "app",
                category: "workspace-app",
              },
            ],
          },
        ],
      },
    ];
    app.workspace.emitApprovalsChanged();
    await until(() => app.tty.text().includes("Approvals (1)"), "approvals overlay");
    expect(app.tty.text()).toContain("(this tab)");
    app.tty.type("\x1b[27u");
    await until(() => app.tty.tabs().includes("!"), "badge on the tab");
    // The browser's own bar names it above the status bar; the tab gives it a row.
    const lines = () => app.tty.text().split("\n");
    await until(() => lines().at(-2)!.includes("Needs you — click here or press Ctrl-B a"), "bar");
    expect(lines().at(-2)).toContain("Welcome — here's what's in your workspace");
    const pty = app.latestPty();
    await until(() => app.shell.pty(pty).rows === 17, "tab one row shorter");
    app.tty.click(10, 18);
    await until(() => app.tty.text().includes("Approvals (1)"), "bar click opens it");
    app.tty.type("\x1b[27u");
    app.workspace.approvals = [];
    app.workspace.emitApprovalsChanged();
    await until(() => !app.tty.text().includes("Needs you"), "bar gone once answered");
    await until(() => app.shell.pty(pty).rows === 18, "tab gets its row back");
  });

  it("decides an approval by clicking its button, only when released on that button", async () => {
    const app = start();
    await startEcho(app);
    const entry = [...app.sessions.entries.values()][0]!;
    app.workspace.approvals = [
      {
        kind: "capability",
        approvalId: "c1",
        callerId: entry.principalId!,
        callerKind: "app",
        repoPath: ECHO,
        effectiveVersion: "ev",
        requestedAt: 1,
        capability: "native.shell.execute",
        title: "Run a command",
        cardType: "confirm.critical",
        allowedDecisions: ["once", "deny"],
      },
    ];
    app.workspace.emitApprovalsChanged();
    await until(() => app.tty.text().includes("[1] Confirm"), "decision buttons");
    // Only the decisions this request allows are buttons.
    expect(app.tty.text()).not.toContain("[3]");
    const confirm = app.tty.find("[1] Confirm");
    // Pressed on the button, released off it: nothing is decided.
    app.tty.pressAndRelease(
      { x: confirm.x + 1, y: confirm.y },
      { x: confirm.x + 1, y: confirm.y - 2 }
    );
    // Pressed off it, released on it: nothing either.
    app.tty.pressAndRelease(
      { x: confirm.x + 1, y: confirm.y - 2 },
      { x: confirm.x + 1, y: confirm.y }
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(app.workspace.resolved).toEqual([]);
    app.tty.click(confirm.x + 1, confirm.y);
    await until(() => app.workspace.resolved.length > 0, "decided");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(app.workspace.resolved).toEqual(["c1:once"]);
  });

  it("fills and submits a protected form by clicking its field and Submit", async () => {
    const app = start();
    await startEcho(app);
    const entry = [...app.sessions.entries.values()][0]!;
    app.workspace.approvals = [
      {
        kind: "secret-input",
        approvalId: "protected",
        callerId: entry.principalId!,
        callerKind: "app",
        repoPath: ECHO,
        effectiveVersion: "ev",
        requestedAt: 1,
        title: "Provide token",
        fields: [{ name: "token", label: "Token", required: true, type: "secret" }],
      },
    ];
    app.workspace.emitApprovalsChanged();
    await until(() => app.tty.text().includes("[Enter] Submit"), "protected form");
    app.tty.type("\t"); // focus leaves the field for the Submit stop
    const field = app.tty.find("Token *:");
    app.tty.click(field.x + 1, field.y);
    app.tty.type("\x1b[200~secret-value\x1b[201~");
    await until(() => app.tty.text().includes("•"), "typed into the clicked field");
    expect(app.tty.text()).not.toContain("secret-value");
    const submit = app.tty.find("[Enter] Submit");
    app.tty.click(submit.x + 1, submit.y);
    await until(() => app.workspace.submitted.length === 1, "submitted");
    expect(app.workspace.submitted[0]).toMatchObject({
      id: "protected",
      values: { token: "secret-value" },
    });
    expect(app.tty.written.join("")).not.toContain("secret-value");
  });

  it("ends a session from its confirmation by clicking End it", async () => {
    const app = start();
    await startEcho(app);
    const entry = [...app.sessions.entries.values()][0]!;
    app.tty.type(`${PREFIX}x`);
    await until(() => app.tty.text().includes("[y] End it"), "confirmation buttons");
    const end = app.tty.find("[y] End it");
    app.tty.pressAndRelease({ x: end.x + 1, y: end.y }, { x: end.x + 1, y: end.y - 3 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(app.sessions.closed).toEqual([]);
    app.tty.click(end.x + 1, end.y);
    await until(() => app.sessions.closed.includes(entry.sessionId), "ended");
  });

  it("returns to the launcher when an overlay closes with nothing open", async () => {
    const { tty } = start();
    await until(() => tty.text().includes("what would you like to open?"), "launcher");
    tty.type(`${PREFIX}?`);
    await until(() => tty.text().includes("Every key goes to the session"), "help");
    expect(tty.text()).toContain("Ctrl-B o");
    tty.type("\x1b[27u");
    await until(() => tty.text().includes("what would you like to open?"), "launcher again");
  });

  it("lists every prefix command in full when the prefix is pressed", async () => {
    const app = start();
    await startEcho(app);
    app.tty.stdout.rows = 40;
    app.tty.screen.resize(100, 40);
    app.tty.stdout.emit("resize");
    app.tty.type(PREFIX);
    await until(() => app.tty.text().includes("the browser menu"), "prefix menu");
    const text = app.tty.text();
    for (const description of [
      "Search retained terminal rows (literal, case-sensitive)",
      "Detach: close this tab, the program keeps running",
      "Quit (programs keep running; resume them later)",
    ])
      expect(text).toContain(description);
    expect(text).toContain("press a key from the menu above");
    app.tty.type("\x1b[27u");
    await until(() => !app.tty.text().includes("the browser menu"), "menu closed");
    // Narrow terminals get one column that wraps instead of cutting descriptions.
    app.tty.stdout.columns = 40;
    app.tty.screen.resize(40, 40);
    app.tty.stdout.emit("resize");
    app.tty.type(PREFIX);
    await until(() => app.tty.text().includes("the browser"), "narrow prefix menu");
    const narrow = app.tty
      .text()
      .replace(/[│╭╮╰╯─]/g, " ")
      .replace(/\s+/g, " ");
    expect(narrow).toContain("Quit (programs keep running; resume them later)");
  });

  it("quits from the empty launcher on Ctrl-C twice", async () => {
    const app = start();
    await until(() => app.tty.text().includes("what would you like to open?"), "launcher");
    app.tty.type("\x03");
    await until(() => app.tty.text().includes("Press Ctrl-C again to quit"), "armed");
    app.tty.type("x\x03");
    await new Promise((resolve) => setTimeout(resolve, 20));
    let finished = false;
    void app.done.then(() => {
      finished = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(finished).toBe(false);
    app.tty.type("\x03");
    await expect(app.done).resolves.toEqual({ kind: "quit" });
  });

  /** The screen cell where `text` is painted (first match). */
  function cellOf(tty: App["tty"], text: string): { x: number; y: number } {
    const lines = tty.text().split("\n");
    const y = lines.findIndex((line) => line.includes(text));
    if (y === -1) throw new Error(`"${text}" is not on screen:\n${tty.text()}`);
    return { x: lines[y]!.indexOf(text), y };
  }

  it("starts what a click lands on in the launcher", async () => {
    const app = start();
    await until(() => app.tty.text().includes("Echoes what you type."), "launcher");
    const { x, y } = cellOf(app.tty, "Echoes what you type.");
    app.tty.click(x, y);
    await until(() => app.tty.tabs().includes("1:🔊 Echo"), "Echo tab");
  });

  it("runs a prefix menu entry on click, and a click elsewhere cancels the prefix", async () => {
    const app = start();
    await startEcho(app);
    app.tty.stdout.rows = 40;
    app.tty.screen.resize(100, 40);
    app.tty.stdout.emit("resize");
    app.tty.type(PREFIX);
    await until(() => app.tty.text().includes("the browser menu"), "prefix menu");
    app.tty.click(50, 0);
    await until(() => !app.tty.text().includes("the browser menu"), "cancelled by a click away");
    expect(app.tty.text()).not.toContain("press a key from the menu above");
    app.tty.type(PREFIX);
    await until(() => app.tty.text().includes("the browser menu"), "prefix menu again");
    const { x, y } = cellOf(app.tty, "Help: every key binding");
    app.tty.click(x + 2, y);
    await until(() => app.tty.text().includes("Every key goes to the session"), "help");
  });

  it("closes the palette on a click outside it", async () => {
    const app = start();
    await startEcho(app);
    app.tty.type(`${PREFIX}k`);
    await until(() => app.tty.text().includes("Commands"), "palette");
    app.tty.click(1, 10);
    await until(() => !app.tty.text().includes("Commands"), "palette closed");
  });

  it("steps a setting when its ‹ › arrows are clicked", async () => {
    const app = start();
    await until(() => app.tty.text().includes("Echo"), "launcher");
    app.tty.type(`${PREFIX}s`);
    await until(() => app.tty.text().includes("Prefix key"), "settings");
    const line = cellOf(app.tty, "Prefix key");
    const arrow = app.tty.text().split("\n")[line.y]!.lastIndexOf("›");
    app.tty.click(arrow, line.y);
    await until(() => app.sessions.settings["prefixKey"] === "C-]", "stepped forward");
    const back = app.tty.text().split("\n")[line.y]!.lastIndexOf("‹");
    app.tty.click(back, line.y);
    await until(() => app.sessions.settings["prefixKey"] === "C-b", "stepped back");
  });

  it("selects an approval on click but leaves every decision to keys", async () => {
    const app = start();
    await startEcho(app);
    const entry = [...app.sessions.entries.values()][0]!;
    const request = (approvalId: string, title: string): PendingApproval => ({
      kind: "capability",
      approvalId,
      callerId: entry.principalId!,
      callerKind: "app",
      repoPath: ECHO,
      effectiveVersion: "ev",
      requestedAt: 1,
      capability: "server-logs.read",
      title,
    });
    app.workspace.approvals = [request("first", "Read logs"), request("second", "Write notes")];
    app.workspace.emitApprovalsChanged();
    await until(() => app.tty.text().includes("Approvals (2)"), "approvals overlay");
    const { x, y } = cellOf(app.tty, "2. Write notes");
    // The detail below the queue names the selected request on a line of its own.
    const detailOf = (title: string) =>
      app.tty
        .text()
        .split("\n")
        .some((line) => new RegExp(`^│ ${title}\\s+│$`).test(line));
    expect(detailOf("Read logs")).toBe(true);
    app.tty.click(x, y);
    await until(() => detailOf("Write notes"), "second request selected");
    // Clicking the selected request, or anywhere outside, never consents or closes.
    app.tty.click(x, y);
    app.tty.click(1, 0);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(app.workspace.resolved).toEqual([]);
    expect(app.tty.text()).toContain("Approvals (2)");
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

  it.each(["admission", "read"] as const)(
    "joins a held approval %s when quitting before initial readiness",
    async (stage) => {
      let admitted = false;
      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const app = start(undefined, (workspace) => {
        const wait = async () => {
          admitted = true;
          await held;
        };
        if (stage === "admission") workspace.admitApprovalWatch = wait;
        else
          workspace.readApprovals = async () => {
            await wait();
            return [];
          };
      });
      try {
        await until(
          () => admitted && app.tty.text().includes("what would you like to open?"),
          "held initial approval work and browser chrome"
        );
        app.tty.type(`${PREFIX}q`);
        expect(app.tty.stdin.rawModes).toEqual([true]);
      } finally {
        release();
      }
      await expect(app.done).resolves.toEqual({ kind: "quit" });
      expect(app.tty.stdin.rawModes).toEqual([true, false]);
    }
  );

  it("retains an independent approval read failure discovered while joining a normal quit", async () => {
    let reading = false;
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const failure = new Error("independent approval projection failure");
    const app = start(undefined, (workspace) => {
      workspace.readApprovals = async () => {
        reading = true;
        await held;
        throw failure;
      };
    });
    const outcome = expect(app.done).rejects.toBe(failure);
    try {
      await until(
        () => reading && app.tty.text().includes("what would you like to open?"),
        "held initial approval read"
      );
      app.tty.type(`${PREFIX}q`);
    } finally {
      release();
    }
    await outcome;
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
    await expect(app.done).resolves.toEqual({
      kind: "switch-workspace",
      workspaceId: "ws-2",
    });
  });

  it("ends with the cause when the connection is lost", async () => {
    const app = start();
    await until(() => app.tty.text().includes("Echo"), "launcher");
    app.setConnection({ phase: "reconnecting", cause: "socket closed" });
    await until(() => app.tty.text().includes("reconnecting (socket closed)"), "reconnecting");
    app.setConnection({ phase: "lost", cause: "credential revoked" });
    await expect(app.done).resolves.toEqual({
      kind: "connection-lost",
      cause: "credential revoked",
    });
  });

  it("persists a changed prefix key and uses it at once", async () => {
    const { tty, sessions } = start();
    await until(() => tty.text().includes("Echo"), "launcher");
    tty.type(`${PREFIX}s`);
    await until(() => tty.text().includes("Prefix key"), "settings");
    tty.type("\x1b[C"); // right: next prefix
    await until(() => sessions.settings["prefixKey"] === "C-]", "saved");
    tty.type("\x1b[27u");
    tty.type("\x1d?");
    await until(() => tty.text().includes("Every key goes to the session"), "help via new prefix");
    tty.type("\x1b[27u");
    tty.type("\x1dq");
  });

  it("refuses to run without a terminal", async () => {
    const tty = new FakeTty();
    (tty.stdout as { isTTY: boolean }).isTTY = false;
    const host = {
      contractVersion: TERMINAL_BROWSER_HOST_CONTRACT_VERSION,
      signal: new AbortController().signal,
      files: { upload: vi.fn(), download: vi.fn(), saveText: vi.fn() },
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
