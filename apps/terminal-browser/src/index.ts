import React from "react";
import { render } from "ink";
import type {
  TerminalBrowserExit,
  TerminalBrowserHost,
} from "@vibestudio/shell-core/terminal/terminalBrowserHost";
import { SessionManager } from "./host/SessionManager.js";
import { registerHostService } from "./host/HostService.js";
import { createApprovalsClient } from "./approvals/approvalsClient.js";
import { TerminalBrowser } from "./host/TerminalBrowser.js";
import type { LogLine } from "./ui/LogsView.js";

import { EventsClient } from "@vibestudio/service-schemas/clients/eventsClient";

/** Minimal append-only log sink shared by the runner events + the LogsView. */
interface LogSink {
  lines: LogLine[];
  push(line: LogLine): void;
  subscribe(listener: () => void): () => void;
}
function createLogSink(): LogSink {
  const lines: LogLine[] = [];
  const listeners = new Set<() => void>();
  return {
    lines,
    push(line) {
      lines.push(line);
      if (lines.length > 500) lines.splice(0, lines.length - 500);
      for (const l of [...listeners]) l();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/**
 * Entry point called by `vibestudio terminal` (see
 * `@vibestudio/shell-core/terminal/terminalBrowserHost`). The CLI owns the RPC
 * connection, the app identity and any server it started; the browser owns
 * the TTY until this promise settles.
 */
export async function run(
  host: TerminalBrowserHost,
): Promise<TerminalBrowserExit> {
  const { rpc, stdin, stdout } = host;
  const logSink = createLogSink();
  const events = new EventsClient(rpc);
  for (const event of ["apps:lifecycle", "apps:status"] as const) {
    events.on(event, (payload) => {
      logSink.push({
        level: "info",
        source: event,
        message: JSON.stringify(payload),
      });
    });
  }
  await events.subscribeAll(["apps:lifecycle", "apps:status"]);

  const viewport = () => ({
    columns: stdout.columns ?? 80,
    rows: Math.max(1, (stdout.rows ?? 24) - 2), // reserve header + footer
  });
  const sessions = new SessionManager({
    rpc,
    hostPrincipalId: host.appId,
    viewport: viewport(),
  });

  const hostState = { overlayOpen: false };
  registerHostService(rpc, {
    sessions,
    // Host keeps the real TTY in raw mode while running; only allow enabling.
    setRealRawMode: (enabled) => {
      if (enabled) stdin.setRawMode?.(true);
    },
    isOverlayOpen: () => hostState.overlayOpen,
  });

  const approvals = createApprovalsClient(rpc);
  const HostRoot: React.FC = () => {
    const [, force] = React.useState(0);
    React.useEffect(() => logSink.subscribe(() => force((n) => n + 1)), []);
    return React.createElement(TerminalBrowser, {
      sessions,
      approvals,
      workspaceId: host.workspace.id,
      logs: logSink.lines,
      hostState,
    });
  };

  const instance = render(React.createElement(HostRoot), {
    exitOnCtrlC: false,
    stdin,
    stdout,
  });

  const onResize = () => void sessions.resize(viewport());
  stdout.on("resize", onResize);
  let exit: TerminalBrowserExit = { kind: "quit" };
  const stopWatchingConnection = host.onConnectionState((state) => {
    if (state.phase !== "lost") return;
    exit = { kind: "connection-lost", cause: state.cause };
    instance.unmount();
  });
  try {
    await instance.waitUntilExit();
  } finally {
    stopWatchingConnection();
    stdout.off("resize", onResize);
    await sessions.closeAll("host exit").catch(() => undefined);
  }
  return exit;
}
