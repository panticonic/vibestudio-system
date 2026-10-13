/**
 * Server Logs as a terminal app: follow the workspace server's log live,
 * filter by level and search. The filter is the session's durable state, so
 * a resumed or relaunched session reopens exactly where the person left it.
 */
import { render } from "ink";
import { mainRpcMethods } from "@vibestudio/service-schemas/mainRpc";
import { readEventWatchRecords } from "@vibestudio/shared/events";
import { startTerminalApp, TerminalLaunchError, type TerminalApp } from "@workspace/terminal-app";
import { LogViewer, type FilterStore, type LogSource, type LogTerminal } from "./LogViewer.js";
import { DEFAULT_FILTER, LOG_LEVELS, type LogFilter, type LogRecord } from "./logModel.js";

const ALT_SCREEN_ON = "\x1b[?1049h";
const ALT_SCREEN_OFF = "\x1b[?1049l";
const FOCUS_REPORTS_ON = "\x1b[?1004h";
const FOCUS_REPORTS_OFF = "\x1b[?1004l";

function logSource(app: TerminalApp): LogSource {
  return {
    async tail(limit) {
      const envelope = await app.rpc.call("main", mainRpcMethods["serverLog.tail"], [limit]);
      return envelope.records as LogRecord[];
    },
    async watch(onBatch, signal) {
      const response = await app.rpc.stream(
        "main",
        mainRpcMethods["events.watch"],
        [["server-log:append"], `terminal-server-logs-${app.launch.sessionId}`],
        { signal }
      );
      try {
        for await (const record of readEventWatchRecords(response)) {
          if (record.kind !== "event") continue;
          const payload = record.payload as { records?: LogRecord[] };
          if (Array.isArray(payload.records)) onBatch(payload.records);
        }
      } catch (error) {
        if (!signal.aborted) throw error;
      }
    },
  };
}

function filterStore(app: TerminalApp): FilterStore {
  return {
    load: () => parseFilter(app.state.get()["filter"]),
    save: (filter) => {
      void app.state.patch({ filter }).catch((error: unknown) => {
        process.stderr.write(`Could not save the filter: ${String(error)}\n`);
      });
    },
  };
}

function parseFilter(value: unknown): LogFilter {
  const filter = (value && typeof value === "object" ? value : {}) as Partial<LogFilter>;
  return {
    minLevel: LOG_LEVELS.includes(filter.minLevel as never)
      ? (filter.minLevel as LogFilter["minLevel"])
      : DEFAULT_FILTER.minLevel,
    search: typeof filter.search === "string" ? filter.search : "",
  };
}

/** The PTY this program runs in: size, focus reports (CSI ?1004) and attention (OSC 9 + BEL). */
function ptyTerminal(): LogTerminal & { dispose(): void } {
  let focused = true;
  const focusListeners = new Set<(focused: boolean) => void>();
  const onData = (chunk: Buffer | string) => {
    const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
    if (text.includes("\x1b[I")) focused = true;
    else if (text.includes("\x1b[O")) focused = false;
    else return;
    for (const listener of [...focusListeners]) listener(focused);
  };
  process.stdin.on("data", onData);
  return {
    size: () => ({ columns: process.stdout.columns || 80, rows: process.stdout.rows || 24 }),
    onResize(listener) {
      process.stdout.on("resize", listener);
      return () => process.stdout.off("resize", listener);
    },
    isFocused: () => focused,
    onFocusChange(listener) {
      focusListeners.add(listener);
      return () => focusListeners.delete(listener);
    },
    requestAttention(reason) {
      process.stdout.write(`\x1b]9;Server Logs: ${reason.replace(/[\x00-\x1f]/g, " ")}\x07\x07`);
    },
    dispose: () => process.stdin.off("data", onData),
  };
}

async function main(): Promise<number> {
  let app: TerminalApp;
  try {
    app = await startTerminalApp({ clientLabel: "Vibestudio server logs" });
  } catch (error) {
    const message =
      error instanceof TerminalLaunchError
        ? error.message
        : `Server Logs could not connect to this workspace: ${error instanceof Error ? error.message : String(error)}`;
    process.stderr.write(`\n  ${message}\n\n`);
    return 1;
  }
  const terminal = ptyTerminal();
  process.stdout.write(`${ALT_SCREEN_ON}${FOCUS_REPORTS_ON}\x1b]2;Server Logs\x07`);
  try {
    const instance = render(
      <LogViewer
        source={logSource(app)}
        filters={filterStore(app)}
        terminal={terminal}
        onQuit={() => instance.unmount()}
      />,
      { exitOnCtrlC: true, patchConsole: false }
    );
    await new Promise<void>((resolve) => {
      process.once("SIGHUP", resolve);
      process.once("SIGTERM", resolve);
      void instance.waitUntilExit().then(() => resolve(), () => resolve());
    });
    instance.unmount();
    return 0;
  } finally {
    terminal.dispose();
    process.stdout.write(`${FOCUS_REPORTS_OFF}${ALT_SCREEN_OFF}`);
    await app.close();
  }
}

// The program ends with its session: nothing it started may keep it alive.
process.exit(await main());
