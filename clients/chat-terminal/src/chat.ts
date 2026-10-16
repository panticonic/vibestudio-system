/**
 * The ports the chat client supplies to `@workspace/terminal-chat`: the same
 * `TerminalChatBootstrap` the terminal-app form fills from its launch file,
 * here filled from the terminal host (`TerminalClientHost`, ABI
 * `terminal-host-1`). Each port is built only from what the host granted.
 */
import { basename, isAbsolute, resolve } from "node:path";
import type {
  TerminalClientFiles,
  TerminalClientState,
} from "@vibestudio/shell-core/terminal/terminalClientHost";
import { mainRpcMethods } from "@vibestudio/service-schemas/mainRpc";
import type { RpcClient } from "@vibestudio/rpc";
import { mimeTypeFor, type ChatFiles, type SessionStateStore } from "@workspace/terminal-chat";

const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;

/**
 * Chat files on this computer, through the host's consent-gated `files`
 * module. Each call carries exactly the path the person typed or confirmed
 * (relative paths start at `cwd`), never one the chat derived.
 */
export function hostChatFiles(files: TerminalClientFiles, cwd: string): ChatFiles {
  const absolute = (path: string): string => (isAbsolute(path) ? path : resolve(cwd, path));
  return {
    async read(path, options) {
      if (!path) throw new Error("Type the path of a file to attach.");
      const localPath = absolute(path);
      const file = await files.read({ localPath }, options);
      if (file.bytes.byteLength > MAX_ATTACHMENT_BYTES)
        throw new Error(`${localPath} is larger than 8 MB.`);
      return { name: basename(localPath), mimeType: mimeTypeFor(localPath), bytes: file.bytes };
    },
    async writeExport(path, contents, options) {
      if (!path) throw new Error("Type the path to write the export to.");
      await files.saveText({ localPath: absolute(path), text: contents }, options);
      return { path };
    },
  };
}

type Settings = Record<string, unknown>;

/**
 * The chat's durable state over the host's client state, which the client
 * reads and replaces whole. The committed value is what `get` returns; writes
 * are applied in order and a patch resolves once the host has stored it.
 */
export async function hostSessionState(state: TerminalClientState): Promise<SessionStateStore> {
  let committed: Settings = await state.get();
  let tail: Promise<void> = Promise.resolve();
  const listeners = new Set<() => void>();
  return {
    get: () => committed,
    patch(partial) {
      const write = tail.then(async () => {
        const next: Settings = { ...committed };
        for (const [key, value] of Object.entries(partial)) {
          if (value === null) delete next[key];
          else next[key] = value;
        }
        await state.set(next);
        committed = next;
        for (const listener of [...listeners]) listener();
      });
      // A failed write fails its caller; the next write starts from the committed value.
      tail = write.catch(() => {});
      return write;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

const HOME_CONTEXT_KEY = "chatHomeContext";

/**
 * The workspace context new conversations start in. It is created once for
 * this client on this device and remembered in the client's state, so the
 * person's conversations and drafts are the same on every launch.
 */
export async function homeContext(rpc: RpcClient, store: SessionStateStore): Promise<string> {
  const remembered = store.get()[HOME_CONTEXT_KEY];
  if (typeof remembered === "string" && remembered) return remembered;
  const { contextId } = await rpc.call("main", mainRpcMethods["runtime.createContext"], [{}]);
  await store.patch({ [HOME_CONTEXT_KEY]: contextId });
  return contextId;
}

