import { afterEach, describe, expect, it, vi } from "vitest";
import type { RpcClient } from "@vibestudio/rpc";
import type {
  TerminalClientHost,
  TerminalServerConnectionState,
} from "@vibestudio/shell-core/terminal/terminalClientHost";
import type { TerminalChatBootstrap, TerminalChatIo } from "@workspace/terminal-chat";

const captured: {
  boot?: TerminalChatBootstrap;
  io?: TerminalChatIo;
  signal?: AbortSignal;
  finish?: () => void;
} = {};

vi.mock("@workspace/terminal-chat", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@workspace/terminal-chat")>()),
  runTerminalChat: vi.fn(
    (boot: TerminalChatBootstrap, io: TerminalChatIo, signal?: AbortSignal) => {
      captured.boot = boot;
      captured.io = io;
      captured.signal = signal;
      return new Promise<void>((resolve) => {
        captured.finish = resolve;
        signal?.addEventListener("abort", () => resolve(), { once: true });
      });
    }
  ),
}));

vi.mock("@workspace/approvals-core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@workspace/approvals-core")>()),
  createApprovalsClient: vi.fn(() => ({})),
  createApprovalQueue: vi.fn(() => ({
    getSnapshot: () => ({ status: "ready", pending: [] }),
    subscribe: () => () => {},
    start: async () => {},
    refresh: async () => {},
    stop: async () => {},
  })),
}));

import { run } from "./index.js";

function fakeHost(options: { files?: boolean } = {}) {
  const abort = new AbortController();
  const listeners = new Set<(state: TerminalServerConnectionState) => void>();
  const stored: { value: Record<string, unknown> } = { value: {} };
  const createContext = vi.fn(async () => ({ contextId: "ctx-new" }));
  // A real client binds the run's abort signal through a view; the fake's view is itself.
  const workspaceRpc: { call: typeof createContext; createView: () => unknown } = {
    call: createContext,
    createView: () => workspaceRpc,
  };
  const host = {
    client: { id: "chat", source: "clients/chat-terminal", buildKey: "b1", grantedCapabilities: [] },
    intent: null,
    rpc: {} as RpcClient,
    workspaceRpc: workspaceRpc as unknown as RpcClient,
    stdin: {} as NodeJS.ReadStream,
    stdout: {} as NodeJS.WriteStream,
    signal: abort.signal,
    state: {
      get: async () => stored.value,
      set: async (next: Record<string, unknown>) => {
        stored.value = next;
      },
    },
    update: { pending: () => null, onUpdate: () => () => {}, restartAtSafePoint: vi.fn() },
    onConnectionState: (listener: (state: TerminalServerConnectionState) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    ...(options.files
      ? { files: { upload: vi.fn(), download: vi.fn(), read: vi.fn(), saveText: vi.fn() } }
      : {}),
  } as unknown as TerminalClientHost;
  return {
    host,
    abort,
    stored,
    createContext,
    workspaceRpc,
    lose: (cause: string) => listeners.forEach((l) => l({ phase: "lost", cause })),
  };
}

afterEach(() => {
  for (const key of Object.keys(captured)) delete (captured as Record<string, unknown>)[key];
});

describe("chat client entry", () => {
  it("supplies the host's ports as the chat's one bootstrap input", async () => {
    const h = fakeHost({ files: true });
    const done = run(h.host);
    await vi.waitFor(() => expect(captured.boot).toBeDefined());
    const boot = captured.boot!;
    expect(boot.rpc).toBe(h.workspaceRpc);
    expect(boot.contextId).toBe("ctx-new");
    expect(h.stored.value).toMatchObject({ chatHomeContext: "ctx-new" });
    expect(boot.sessionId).toMatch(/[0-9a-f-]{36}/u);
    expect(boot.files).not.toBeNull();
    expect(captured.io).toMatchObject({
      stdin: h.host.stdin,
      stdout: h.host.stdout,
      approvalsKey: "Ctrl-G",
    });
    expect(captured.io?.surface).toBeDefined();
    captured.finish!();
    await expect(done).resolves.toEqual({ kind: "quit" });
  });

  it("disables attachments from disk when the host granted no local-files capability", async () => {
    const h = fakeHost();
    const done = run(h.host);
    await vi.waitFor(() => expect(captured.boot).toBeDefined());
    expect(captured.boot!.files).toBeNull();
    captured.finish!();
    await done;
  });

  it("reuses the remembered conversation context on a later launch", async () => {
    const h = fakeHost();
    h.stored.value = { chatHomeContext: "ctx-old" };
    const done = run(h.host);
    await vi.waitFor(() => expect(captured.boot).toBeDefined());
    expect(captured.boot!.contextId).toBe("ctx-old");
    expect(h.createContext).not.toHaveBeenCalled();
    captured.finish!();
    await done;
  });

  it("ends the chat when the host's signal aborts (Ctrl-C, restart into an update)", async () => {
    const h = fakeHost();
    const done = run(h.host);
    await vi.waitFor(() => expect(captured.signal).toBeDefined());
    h.abort.abort(new Error("host closing"));
    await expect(done).resolves.toEqual({ kind: "quit" });
    expect(captured.signal?.aborted).toBe(true);
  });

  it("reports a lost connection as the exit instead of failing", async () => {
    const h = fakeHost();
    const done = run(h.host);
    await vi.waitFor(() => expect(captured.signal).toBeDefined());
    h.lose("credential revoked");
    await expect(done).resolves.toEqual({ kind: "connection-lost", cause: "credential revoked" });
  });

  it("propagates a bootstrap failure to the host", async () => {
    const h = fakeHost();
    h.createContext.mockRejectedValueOnce(new Error("workspace unavailable"));
    await expect(run(h.host)).rejects.toThrow("workspace unavailable");
  });
});
