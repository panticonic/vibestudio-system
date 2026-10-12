import { DurableObjectBase, rpc } from "@workspace/runtime/worker/kernel";
import { mainRpcMethods } from "@vibestudio/service-schemas/mainRpc";
import { readEventWatchRecords } from "@vibestudio/shared/events";
import { InkTerminalSessionHost } from "@workspace/terminal-shim";
import type {
  TerminalAttachArgs,
  TerminalHostReply,
  TerminalSession,
  TerminalSize,
} from "@workspace/terminal-host-protocol";
import { LogViewer, type FilterStore, type LogSource } from "./LogViewer.js";
import { DEFAULT_FILTER, LOG_LEVELS, type LogFilter, type LogRecord } from "./logModel.js";

const SESSION_RPC = {
  website: {
    kind: "closed",
    reason: "Terminal sessions are driven only by the person's terminal browser.",
  },
  principals: ["host", "user", "code"],
  effect: { kind: "open" },
  tier: "open",
} as const;

const FILTER_STATE_KEY = "filter";

/**
 * A terminal app that follows the workspace server's log. One DO per terminal
 * session (the object key is the session id); the only durable state is the
 * view filter, so a resumed session reopens exactly where the person left it.
 */
export class ServerLogsSession extends DurableObjectBase implements TerminalSession {
  static override schemaVersion = 1;

  private readonly terminal = new InkTerminalSessionHost({
    render: (session) => (
      <LogViewer source={this.logSource()} filters={this.filterStore()} session={session} />
    ),
    onClose: () => {
      this.deleteStateValue(FILTER_STATE_KEY);
    },
  });

  protected createTables(): void {}

  @rpc({ ...SESSION_RPC, sensitivity: "write" })
  async terminalAttach(args: TerminalAttachArgs): Promise<Response> {
    return this.terminal.attach(this.caller?.callerId, args);
  }

  @rpc({ ...SESSION_RPC, sensitivity: "write" })
  async terminalInput(sessionId: string, data: string): Promise<void> {
    this.terminal.input(this.caller?.callerId, sessionId, data);
  }

  @rpc({ ...SESSION_RPC, sensitivity: "write" })
  async terminalResize(sessionId: string, size: TerminalSize): Promise<void> {
    this.terminal.resize(this.caller?.callerId, sessionId, size);
  }

  @rpc({ ...SESSION_RPC, sensitivity: "write" })
  async terminalFocus(sessionId: string, focused: boolean): Promise<void> {
    this.terminal.focus(this.caller?.callerId, sessionId, focused);
  }

  @rpc({ ...SESSION_RPC, sensitivity: "write" })
  async terminalReply(sessionId: string, reply: TerminalHostReply): Promise<void> {
    this.terminal.reply(this.caller?.callerId, sessionId, reply);
  }

  @rpc({ ...SESSION_RPC, sensitivity: "destructive" })
  async terminalClose(sessionId: string): Promise<void> {
    await this.terminal.close(this.caller?.callerId, sessionId);
  }

  private filterStore(): FilterStore {
    return {
      load: () => parseFilter(this.getStateValue(FILTER_STATE_KEY)),
      save: (filter) => this.setStateValue(FILTER_STATE_KEY, JSON.stringify(filter)),
    };
  }

  private logSource(): LogSource {
    const rpcClient = this.rpc;
    return {
      async tail(limit) {
        const envelope = await rpcClient.call("main", mainRpcMethods["serverLog.tail"], [limit]);
        return envelope.records as LogRecord[];
      },
      async watch(onBatch, signal) {
        const response = await rpcClient.stream(
          "main",
          mainRpcMethods["events.watch"],
          [["server-log:append"], `terminal-server-logs-${crypto.randomUUID()}`],
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
}

function parseFilter(raw: string | null): LogFilter {
  if (!raw) return DEFAULT_FILTER;
  try {
    const value = JSON.parse(raw) as Partial<LogFilter>;
    return {
      minLevel: LOG_LEVELS.includes(value.minLevel as never)
        ? (value.minLevel as LogFilter["minLevel"])
        : DEFAULT_FILTER.minLevel,
      search: typeof value.search === "string" ? value.search : "",
    };
  } catch {
    return DEFAULT_FILTER;
  }
}
