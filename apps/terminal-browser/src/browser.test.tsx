import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { Text, useInput } from "ink";
import xterm from "@xterm/headless";
import type { RpcClient } from "@vibestudio/rpc";
import type { PendingApproval } from "@vibestudio/shared/approvals";
import { encodeEventWatchRecord } from "@vibestudio/shared/events";
import type {
  TerminalBrowserExit,
  TerminalBrowserHost,
  TerminalServerConnectionState,
} from "@vibestudio/shell-core/terminal/terminalBrowserHost";
import { InkTerminalSessionHost, type TerminalSessionHandle } from "@workspace/terminal-shim";
import type { TerminalSessionRecord } from "@workspace-workers/terminal-sessions/contract";
import { run } from "./index.js";

const { Terminal } = xterm as unknown as { Terminal: typeof import("@xterm/headless").Terminal };

/** A tiny terminal app: shows what was typed; "o" asks to open a URL, "e" ends the session. */
function EchoApp({ session }: { session: TerminalSessionHandle }): React.ReactElement {
  const [typed, setTyped] = React.useState("");
  const [opened, setOpened] = React.useState<string>("none");
  React.useEffect(() => session.setTitle("Echo"), [session]);
  useInput((input) => {
    if (input === "o")
      void session.openUrl("https://example.com/docs").then((ok) => setOpened(String(ok)));
    else if (input === "e") session.end("bye");
    else setTyped((t) => t + input);
  });
  return <Text>{`typed:${typed} opened:${opened}`}</Text>;
}

const APP_SOURCE = "workers/echo";
const APP_CLASS = "EchoSession";
const APP_ID = "app:terminal-browser";

class FakeServer {
  readonly sessionHosts = new Map<string, InkTerminalSessionHost>();
  readonly registry = new Map<string, TerminalSessionRecord>();
  settings: Record<string, unknown> = {};
  approvals: PendingApproval[] = [];
  readonly resolved: string[] = [];
  private approvalStream: ReadableStreamDefaultController<Uint8Array> | null = null;
  private contexts = 0;
  readonly attachStreams: ReadableStream<Uint8Array>[] = [];

  hostFor(key: string): InkTerminalSessionHost {
    let host = this.sessionHosts.get(key);
    if (!host) {
      host = new InkTerminalSessionHost({ render: (session) => <EchoApp session={session} /> });
      this.sessionHosts.set(key, host);
    }
    return host;
  }

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
    const call = async (
      target: string,
      method: { name: string },
      args: unknown[]
    ): Promise<unknown> => {
      const name = method.name;
      if (target === "main") {
        switch (name) {
          case "runtime.createEntity": {
            const spec = args[0] as {
              execution: { source: string };
              className: string;
              key: string;
            };
            return {
              targetId: `do:${spec.execution.source}:${spec.className}:${spec.key}`,
              contextId: "ctx",
            };
          }
          case "workers.resolveService":
            expect(args[0]).toBe("vibestudio.terminal-sessions.v1");
            return {
              kind: "durable-object",
              targetId: "do:workers/terminal-sessions:TerminalSessionsDO:workspace-terminal-sessions",
            };
          case "runtime.createContext":
            return { contextId: `ctx-${++this.contexts}` };
          case "workers.listSources":
            return [
              {
                name: "echo",
                source: APP_SOURCE,
                classes: [{ className: APP_CLASS }],
                terminal: {
                  title: "Echo",
                  description: "Echoes what you type.",
                  className: APP_CLASS,
                },
              },
              { name: "plain", source: "workers/plain", classes: [] },
            ];
          case "shellApproval.listPending":
            return this.approvals;
          case "shellApproval.resolve":
            this.resolved.push(String(args[0]));
            this.approvals = this.approvals.filter((a) => a.approvalId !== args[0]);
            return undefined;
        }
        throw new Error(`unexpected main call ${name}`);
      }
      if (target.startsWith("do:workers/terminal-sessions:")) {
        switch (name) {
          case "listSessions":
            return [...this.registry.values()].sort((a, b) => b.lastAttachedAt - a.lastAttachedAt);
          case "recordSession": {
            const draft = args[0] as TerminalSessionRecord;
            const record = { ...draft, createdAt: Date.now(), lastAttachedAt: Date.now() };
            this.registry.set(record.sessionId, record);
            return record;
          }
          case "markAttached":
          case "setSessionTitle": {
            const record = this.registry.get(String(args[0]));
            if (record && name === "setSessionTitle") record.title = String(args[1]);
            return undefined;
          }
          case "forgetSession":
            this.registry.delete(String(args[0]));
            return undefined;
          case "getSettings":
            return this.settings;
          case "setSettings":
            this.settings = args[0] as Record<string, unknown>;
            return undefined;
        }
      }
      const key = target.split(":").at(-1)!;
      const host = this.hostFor(key);
      switch (name) {
        case "terminalInput":
          return host.input(APP_ID, args[0] as string, args[1] as string);
        case "terminalResize":
          return host.resize(APP_ID, args[0] as string, args[1] as never);
        case "terminalFocus":
          return host.focus(APP_ID, args[0] as string, args[1] as boolean);
        case "terminalReply":
          return host.reply(APP_ID, args[0] as string, args[1] as never);
        case "terminalClose":
          return host.close(APP_ID, args[0] as string);
      }
      throw new Error(`unexpected call ${target} ${name}`);
    };
    const stream = async (
      target: string,
      method: { name: string },
      args: unknown[],
      options?: { signal?: AbortSignal }
    ): Promise<Response> => {
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
      if (method.name === "terminalAttach") {
        const key = target.split(":").at(-1)!;
        const response = this.hostFor(key).attach(APP_ID, args[0] as never);
        const body = response.body!;
        this.attachStreams.push(body);
        options?.signal?.addEventListener("abort", () => void body.cancel().catch(() => {}));
        return response;
      }
      throw new Error(`unexpected stream ${method.name}`);
    };
    return { call, stream, selfId: APP_ID } as unknown as RpcClient;
  }
}

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
  readonly screen = new Terminal({ cols: 80, rows: 20, allowProposedApi: true });
  readonly written: string[] = [];
  readonly stdout = Object.assign(new EventEmitter(), {
    isTTY: true,
    columns: 80,
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

  type(data: string): void {
    this.stdin.emit("data", Buffer.from(data));
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

function start(server = new FakeServer()) {
  const tty = new FakeTty();
  currentScreen = () => tty.text();
  let connection: TerminalServerConnectionState = { phase: "connected" };
  const listeners = new Set<(state: TerminalServerConnectionState) => void>();
  const opened: string[] = [];
  const host: TerminalBrowserHost = {
    contractVersion: 1,
    rpc: server.rpc(),
    appId: APP_ID,
    workspace: { id: "ws-1", name: "demo" },
    server: { kind: "attached", endpoint: "http://127.0.0.1:1234" },
    stdin: tty.stdin as unknown as NodeJS.ReadStream,
    stdout: tty.stdout as unknown as NodeJS.WriteStream,
    connectionState: () => connection,
    onConnectionState: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    listWorkspaces: async () => [
      { id: "ws-1", name: "demo" },
      { id: "ws-2", name: "other" },
    ],
    openExternal: async (url) => {
      opened.push(url);
    },
    readLocalFile: async () => ({ name: "a.txt", bytes: new Uint8Array([1]) }),
  };
  let exit: TerminalBrowserExit | null = null;
  const done = run(host).then((result) => {
    exit = result;
    return result;
  });
  return {
    server,
    tty,
    done,
    opened,
    exit: () => exit,
    setConnection(state: TerminalServerConnectionState) {
      connection = state;
      for (const listener of [...listeners]) listener(state);
    },
  };
}

const PREFIX = "\x00";

describe("terminal browser", () => {
  const running: Array<ReturnType<typeof start>> = [];
  const launch = () => {
    const app = start();
    running.push(app);
    return app;
  };
  afterEach(async () => {
    for (const app of running.splice(0)) {
      if (!app.exit()) app.tty.type(`${PREFIX}q`);
      await app.done.catch(() => {});
    }
  });

  it("opens the launcher when there is nothing to resume and launches an app", async () => {
    const { tty } = launch();
    await until(() => tty.text().includes("what would you like to open?"), "launcher");
    expect(tty.text()).toContain("Echo");
    expect(tty.text()).toContain("Echoes what you type.");
    expect(tty.text()).not.toContain("plain");
    tty.type("ech");
    await until(() => tty.text().includes("› ech"), "launcher query");
    tty.type("\r");
    await until(() => tty.text().includes("typed: opened:none"), "session render");
    await until(() => tty.text().split("\n")[0]!.includes("1:Echo"), "tab strip");
    tty.type("abc");
    await until(() => tty.text().includes("typed:abc"), "echo");
  });

  it("keeps every key but the prefix for the session and shows help on prefix ?", async () => {
    const { tty } = launch();
    await until(() => tty.text().includes("Echo"), "launcher");
    tty.type("\r");
    await until(() => tty.text().includes("typed:"), "session");
    tty.type("\x01\x0c\x10z"); // ^A ^L ^P are session keys now
    await until(
      () => tty.text().includes("typed:\x01\x0c\x10z") || tty.text().includes("typed:"),
      "input"
    );
    tty.type(`${PREFIX}?`);
    await until(() => tty.text().includes("Every key goes to the session"), "help");
    expect(tty.text()).toContain("Ctrl-Space k");
    tty.type("\x1b");
    await until(() => !tty.text().includes("Every key goes to the session"), "help closed");
  });

  it("detaches without closing and resumes the same session", async () => {
    const { tty, server } = launch();
    await until(() => tty.text().includes("Echo"), "launcher");
    tty.type("\r");
    await until(() => tty.text().includes("typed:"), "session");
    expect(server.registry.size).toBe(1);
    tty.type(`${PREFIX}d`);
    await until(() => tty.text().includes("Resume"), "resumable session listed");
    expect(server.registry.size).toBe(1);
    tty.type("\r");
    await until(() => tty.text().includes("typed:") && tty.text().includes("1:Echo"), "resumed");
    expect(server.attachStreams.length).toBe(2);
  });

  it("resumes the most recent session on start", async () => {
    const server = new FakeServer();
    server.registry.set("s-old", {
      sessionId: "s-old",
      source: APP_SOURCE,
      className: APP_CLASS,
      title: "Echo",
      contextId: "ctx-old",
      createdAt: 1,
      lastAttachedAt: 2,
    });
    const app = start(server);
    running.push(app);
    await until(() => app.tty.text().includes("typed:"), "auto-resume");
  });

  it("opens approvals by itself for the focused session and decides with a digit", async () => {
    const { tty, server } = launch();
    await until(() => tty.text().includes("Echo"), "launcher");
    tty.type("\r");
    await until(() => tty.text().includes("typed:"), "session");
    server.approvals = [
      {
        kind: "capability",
        approvalId: "a1",
        callerId: `do:${APP_SOURCE}:${APP_CLASS}:${[...server.registry.keys()][0]}`,
        callerKind: "do",
        repoPath: APP_SOURCE,
        effectiveVersion: "ev",
        requestedAt: 1,
        capability: "server-logs.read",
        title: "Read server logs",
      },
    ];
    server.emitApprovalsChanged();
    await until(() => tty.text().includes("Approvals (1)"), "approvals overlay");
    expect(tty.text()).toContain("requested by Echo (this tab)");
    tty.type("1");
    await until(() => server.resolved.includes("a1"), "decision");
    await until(() => !tty.text().includes("Approvals (1)"), "overlay closes when queue empties");
  });

  it("returns to the launcher when an overlay closes with nothing open", async () => {
    const { tty } = launch();
    await until(() => tty.text().includes("what would you like to open?"), "launcher");
    tty.type(`${PREFIX}a`);
    await until(() => tty.text().includes("Approvals (0)"), "approvals");
    tty.type("\x1b");
    await until(() => tty.text().includes("what would you like to open?"), "launcher again");
  });

  it("asks before opening a URL for a session and reports the answer back", async () => {
    const { tty, opened } = launch();
    await until(() => tty.text().includes("Echo"), "launcher");
    tty.type("\r");
    await until(() => tty.text().includes("typed:"), "session");
    tty.type("o");
    await until(() => tty.text().includes("wants to open a link"), "confirmation");
    expect(tty.text()).toContain("https://example.com/docs");
    expect(opened).toEqual([]);
    tty.type("o");
    await until(() => tty.text().includes("opened:true"), "answer");
    expect(opened).toEqual(["https://example.com/docs"]);
  });

  it("closes the tab when the session ends itself", async () => {
    const { tty, server } = launch();
    await until(() => tty.text().includes("Echo"), "launcher");
    tty.type("\r");
    await until(() => tty.text().includes("typed:"), "session");
    tty.type("e");
    await until(() => tty.text().includes("Echo ended: bye"), "ended notice");
    expect(server.registry.size).toBe(0);
  });

  it("quits with the terminal restored", async () => {
    const app = launch();
    await until(() => app.tty.text().includes("Echo"), "launcher");
    app.tty.type(`${PREFIX}q`);
    await expect(app.done).resolves.toEqual({ kind: "quit" });
    const output = app.tty.written.join("");
    expect(output).toContain("\x1b[?1049h");
    expect(output.endsWith("\x1b[?1049l")).toBe(true);
    expect(app.tty.stdin.rawModes).toEqual([true, false]);
  });

  it("switches workspace through the workspace list", async () => {
    const app = launch();
    await until(() => app.tty.text().includes("Echo"), "launcher");
    app.tty.type(`${PREFIX}w`);
    await until(
      () => app.tty.text().includes("Switch workspace") && app.tty.text().includes("other"),
      "workspaces"
    );
    app.tty.type("oth\r");
    await expect(app.done).resolves.toEqual({ kind: "switch-workspace", workspaceId: "ws-2" });
  });

  it("shows reconnecting, and ends with the cause when the connection is lost", async () => {
    const app = launch();
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
    const { tty, server } = launch();
    await until(() => tty.text().includes("Echo"), "launcher");
    tty.type(`${PREFIX}s`);
    await until(() => tty.text().includes("Prefix key"), "settings");
    tty.type("\x1b[C"); // right: next prefix
    await until(() => server.settings["prefixKey"] === "C-a", "saved");
    tty.type("\x1b");
    tty.type("\x01?");
    await until(() => tty.text().includes("Every key goes to the session"), "help via new prefix");
    tty.type("\x1b");
    tty.type("\x01q");
  });

  it("refuses to run without a terminal", async () => {
    const server = new FakeServer();
    const tty = new FakeTty();
    (tty.stdout as { isTTY: boolean }).isTTY = false;
    const host = {
      contractVersion: 1,
      rpc: server.rpc(),
      appId: APP_ID,
      workspace: { id: "ws", name: "ws" },
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
