import { randomUUID } from "node:crypto";
import { isRpcAbortedBy, withRpcAbortSignal } from "@vibestudio/rpc";
import type {
  TerminalClientExit,
  TerminalClientHost,
} from "@vibestudio/shell-core/terminal/terminalClientHost";
import { createApprovalQueue, createApprovalsClient } from "@workspace/approvals-core";
import { terminalPendingUpdate } from "@workspace/client-kit-terminal";
import { runTerminalChat, type TerminalChatBootstrap } from "@workspace/terminal-chat";
import { hostChatFiles, hostSessionState, homeContext } from "./chat.js";
import { HostSurface, SURFACE_KEY_LABEL } from "./hostSurface.js";

/**
 * Run the chat on the host's terminal until the person quits, the host ends
 * the run (`host.signal`, which also carries a restart into a newer build) or
 * the connection is lost for good.
 *
 * The conversation, approvals and sign-in all live in the workspace the
 * client shows, so they use this device's session there (`workspaceRpc`); the
 * client's own principal session (`rpc`) stays in the System workspace, where
 * the client is installed.
 */
export async function runChat(host: TerminalClientHost): Promise<TerminalClientExit> {
  const lifetime = new AbortController();
  const endRun = () => lifetime.abort(host.signal.reason ?? new Error("Chat closed"));
  if (host.signal.aborted) endRun();
  else host.signal.addEventListener("abort", endRun, { once: true });

  let exit: TerminalClientExit = { kind: "quit" };
  const stopWatching = host.onConnectionState((state) => {
    if (state.phase !== "lost") return;
    exit = { kind: "connection-lost", cause: state.cause };
    lifetime.abort(new Error(state.cause));
  });

  const rpc = host.workspaceRpc;
  const scoped = withRpcAbortSignal(rpc, lifetime.signal);
  const approvals = createApprovalsClient(scoped);
  const surface = new HostSurface({
    queue: createApprovalQueue(approvals),
    approvals,
    pendingUpdate: () => {
      const update = host.update.pending();
      return update ? terminalPendingUpdate(host.client, update) : null;
    },
    restartAtSafePoint: () => host.update.restartAtSafePoint(),
    report: (message, error) => reportToHost(host, message, error),
  });
  const stopUpdates = host.update.onUpdate(() => surface.updateChanged());

  let failure: unknown;
  let endedByHost = false;
  try {
    const state = await hostSessionState(host.state);
    const boot: TerminalChatBootstrap = {
      rpc,
      contextId: await homeContext(rpc, state),
      sessionId: randomUUID(),
      state,
      files: host.files ? hostChatFiles(host.files, process.cwd()) : null,
    };
    await surface.start();
    await runTerminalChat(
      boot,
      { stdin: host.stdin, stdout: host.stdout, approvalsKey: SURFACE_KEY_LABEL, surface },
      lifetime.signal
    );
  } catch (error) {
    failure = error;
  } finally {
    endedByHost = lifetime.signal.aborted;
    stopWatching();
    stopUpdates();
    host.signal.removeEventListener("abort", endRun);
    lifetime.abort(lifetime.signal.reason ?? new Error("Chat closed"));
    const disposal = await Promise.allSettled([surface.dispose(lifetime.signal.reason)]);
    for (const result of disposal)
      if (result.status === "rejected" && !isRpcAbortedBy(result.reason, lifetime.signal.reason))
        failure ??= result.reason;
  }
  // Cancellation by the host or a lost connection is how the run ends, not a failure.
  if (failure !== undefined && !(endedByHost && isRpcAbortedBy(failure, lifetime.signal.reason)))
    throw failure;
  return exit;
}

function reportToHost(host: TerminalClientHost, message: string, error: unknown): void {
  const detail = error instanceof Error ? error.message : String(error);
  host.notify?.notify({ title: message, body: detail });
  console.error(`[chat] ${message}: ${detail}`);
}
