import { describe, expect, it, vi } from "vitest";
import type {
  TerminalClientFiles,
  TerminalClientState,
} from "@vibestudio/shell-core/terminal/terminalClientHost";
import type { RpcClient } from "@vibestudio/rpc";
import { homeContext, hostChatFiles, hostSessionState } from "./chat.js";

function fakeFiles(): TerminalClientFiles & {
  read: ReturnType<typeof vi.fn>;
  saveText: ReturnType<typeof vi.fn>;
} {
  return {
    upload: vi.fn(),
    download: vi.fn(),
    read: vi.fn(async ({ localPath }: { localPath: string }) => ({
      path: localPath,
      size: 3,
      bytes: new Uint8Array([1, 2, 3]),
    })),
    saveText: vi.fn(async ({ localPath }: { localPath: string }) => ({ path: localPath, size: 1 })),
  } as never;
}

describe("hostChatFiles", () => {
  it("reads exactly the path the person typed, relative paths starting at the working directory", async () => {
    const files = fakeFiles();
    const chat = hostChatFiles(files, "/work/project");
    const note = await chat.read("notes/todo.md");
    expect(files.read).toHaveBeenCalledWith({ localPath: "/work/project/notes/todo.md" }, undefined);
    expect(note).toMatchObject({ name: "todo.md", mimeType: "text/markdown" });
    await chat.read("/abs/pic.png");
    expect(files.read).toHaveBeenLastCalledWith({ localPath: "/abs/pic.png" }, undefined);
  });

  it("refuses a file over the attachment limit and an empty path", async () => {
    const files = fakeFiles();
    files.read.mockResolvedValueOnce({
      path: "/big",
      size: 9 * 1024 * 1024,
      bytes: new Uint8Array(9 * 1024 * 1024),
    });
    const chat = hostChatFiles(files, "/work");
    await expect(chat.read("big")).rejects.toThrow("larger than 8 MB");
    await expect(chat.read("")).rejects.toThrow("Type the path");
  });

  it("writes an export only to the destination the person confirmed", async () => {
    const files = fakeFiles();
    const chat = hostChatFiles(files, "/work");
    await expect(chat.writeExport("out/chat.md", "# hi")).resolves.toBe("out/chat.md");
    expect(files.saveText).toHaveBeenCalledWith(
      { localPath: "/work/out/chat.md", text: "# hi" },
      undefined
    );
    await expect(chat.writeExport("", "x")).rejects.toThrow("Type the path");
  });

  it("propagates the host's refusal to overwrite", async () => {
    const files = fakeFiles();
    files.saveText.mockRejectedValueOnce(new Error("already exists"));
    await expect(hostChatFiles(files, "/w").writeExport("a.md", "x")).rejects.toThrow("already exists");
  });
});

function memoryState(initial: Record<string, unknown> = {}) {
  const stored = { value: initial, writes: 0 };
  const state: TerminalClientState = {
    get: async () => stored.value,
    set: async (next) => {
      stored.writes += 1;
      stored.value = next;
    },
  };
  return { state, stored };
}

describe("hostSessionState", () => {
  it("merges patches into the whole object, deletes on null, and notifies after storing", async () => {
    const { state, stored } = memoryState({ keep: 1, drop: 2 });
    const store = await hostSessionState(state);
    const seen: unknown[] = [];
    store.subscribe(() => seen.push({ ...store.get() }));
    await store.patch({ added: "x", drop: null });
    expect(stored.value).toEqual({ keep: 1, added: "x" });
    expect(store.get()).toEqual({ keep: 1, added: "x" });
    expect(seen).toEqual([{ keep: 1, added: "x" }]);
  });

  it("applies concurrent patches in order and survives a failed write", async () => {
    const { state, stored } = memoryState();
    const store = await hostSessionState(state);
    const failing = vi.spyOn(state, "set").mockRejectedValueOnce(new Error("disk full"));
    const first = store.patch({ a: 1 });
    const second = store.patch({ b: 2 });
    await expect(first).rejects.toThrow("disk full");
    await second;
    expect(failing).toHaveBeenCalledTimes(2);
    expect(stored.value).toEqual({ b: 2 });
  });
});

describe("homeContext", () => {
  const rpcCreating = (contextId: string) => {
    const call = vi.fn(async () => ({ contextId }));
    return { rpc: { call } as unknown as RpcClient, call };
  };

  it("creates the context once and remembers it for later launches", async () => {
    const { state, stored } = memoryState();
    const store = await hostSessionState(state);
    const first = rpcCreating("ctx-1");
    await expect(homeContext(first.rpc, store)).resolves.toBe("ctx-1");
    expect(first.call).toHaveBeenCalledOnce();
    expect(stored.value).toMatchObject({ chatHomeContext: "ctx-1" });
    const later = rpcCreating("ctx-2");
    await expect(homeContext(later.rpc, await hostSessionState(state))).resolves.toBe("ctx-1");
    expect(later.call).not.toHaveBeenCalled();
  });
});
