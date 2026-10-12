import React from "react";
import { Box, Text, useInput } from "ink";
import { useTerminalSize, type TerminalSessionHandle } from "@workspace/terminal-shim";
import {
  LOG_LEVELS,
  appendRecords,
  formatLine,
  matches,
  visibleWindow,
  type LogFilter,
  type LogLevel,
  type LogRecord,
} from "./logModel.js";

/** Where the viewer reads records from (the DO wires the serverLog service). */
export interface LogSource {
  /** The newest `limit` records, oldest first. */
  tail(limit: number): Promise<LogRecord[]>;
  /** Deliver live batches until `signal` aborts; rejects if the live feed fails. */
  watch(onBatch: (records: LogRecord[]) => void, signal: AbortSignal): Promise<void>;
}

/** Durable view preferences, restored on every attachment. */
export interface FilterStore {
  load(): LogFilter;
  save(filter: LogFilter): void;
}

export interface LogViewerProps {
  source: LogSource;
  filters: FilterStore;
  session: Pick<TerminalSessionHandle, "isFocused" | "onFocusChange" | "setAttention">;
}

type Phase = { kind: "loading" } | { kind: "live" } | { kind: "error"; message: string };

const LEVEL_COLOR: Record<LogLevel, string | undefined> = {
  verbose: "gray",
  info: undefined,
  warn: "yellow",
  error: "red",
};

export function LogViewer({ source, filters, session }: LogViewerProps): React.ReactElement {
  const { columns, rows } = useTerminalSize();
  const [records, setRecords] = React.useState<LogRecord[]>([]);
  const [phase, setPhase] = React.useState<Phase>({ kind: "loading" });
  const [filter, setFilter] = React.useState<LogFilter>(() => filters.load());
  const [offset, setOffset] = React.useState(0);
  const [draft, setDraft] = React.useState<string | null>(null);
  const [attempt, setAttempt] = React.useState(0);

  const updateFilter = (next: LogFilter) => {
    setFilter(next);
    setOffset(0);
    filters.save(next);
  };

  // Load the tail, then follow live batches for as long as this attachment lives.
  React.useEffect(() => {
    const controller = new AbortController();
    setPhase({ kind: "loading" });
    void (async () => {
      try {
        const initial = await source.tail(1000);
        if (controller.signal.aborted) return;
        setRecords((current) => appendRecords(current, initial));
        setPhase({ kind: "live" });
        await source.watch((batch) => {
          setRecords((current) => appendRecords(current, batch));
          if (!session.isFocused() && batch.some((record) => record.level === "error")) {
            session.setAttention({ reason: "new server error" });
          }
        }, controller.signal);
        if (!controller.signal.aborted) {
          setPhase({ kind: "error", message: "The live log feed ended." });
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        setPhase({
          kind: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    })();
    return () => controller.abort();
  }, [source, attempt]);

  React.useEffect(
    () =>
      session.onFocusChange((focused) => {
        if (focused) session.setAttention(null);
      }),
    [session]
  );

  const listHeight = Math.max(1, rows - 2);
  const visible = React.useMemo(() => records.filter((r) => matches(r, filter)), [records, filter]);
  const window = visibleWindow(visible, listHeight, offset);

  useInput((input, key) => {
    if (draft !== null) {
      if (key.escape) setDraft(null);
      else if (key.return) {
        updateFilter({ ...filter, search: draft.trim() });
        setDraft(null);
      } else if (key.backspace || key.delete) setDraft(draft.slice(0, -1));
      else if (input && !key.ctrl && !key.meta) setDraft(draft + input);
      return;
    }
    if (key.upArrow || input === "k") setOffset(window.offset + 1);
    else if (key.downArrow || input === "j") setOffset(Math.max(0, window.offset - 1));
    else if (key.pageUp) setOffset(window.offset + listHeight);
    else if (key.pageDown) setOffset(Math.max(0, window.offset - listHeight));
    else if (input === "g" || key.home) setOffset(visible.length);
    else if (input === "G" || key.end) setOffset(0);
    else if (input >= "1" && input <= "4") {
      updateFilter({ ...filter, minLevel: LOG_LEVELS[Number(input) - 1]! });
    } else if (input === "/") setDraft(filter.search);
    else if (input === "c") updateFilter({ ...filter, search: "" });
    else if (input === "r" && phase.kind === "error") setAttempt((n) => n + 1);
  });

  const following = window.offset === 0;
  const header = [
    "Server Logs",
    `level ≥ ${filter.minLevel}`,
    filter.search ? `matching "${filter.search}"` : null,
    `${visible.length} of ${records.length} lines`,
    following ? "following" : `${window.offset} lines up`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Box flexDirection="column" width={columns} height={rows}>
      <Text bold wrap="truncate-end">
        {header}
      </Text>
      <Box flexDirection="column" height={listHeight}>
        {phase.kind === "loading" && records.length === 0 ? (
          <Box flexDirection="column">
            <Text>Loading the server log…</Text>
            <Text dimColor wrap="wrap">
              Reading server logs needs your approval the first time. If an approval is waiting, the
              terminal browser shows it now — choose how long to allow it there.
            </Text>
          </Box>
        ) : phase.kind === "error" && records.length === 0 ? (
          <Box flexDirection="column">
            <Text color="red" wrap="wrap">{`Could not read the server log: ${phase.message}`}</Text>
            <Text dimColor>Press r to try again.</Text>
          </Box>
        ) : visible.length === 0 ? (
          <Text dimColor wrap="wrap">
            {records.length === 0
              ? "No log lines yet. New lines appear here as the server writes them."
              : "No lines match. Press 1 to show every level, or c to clear the search."}
          </Text>
        ) : (
          window.rows.map((record) => (
            <Text key={record.seq} color={LEVEL_COLOR[record.level]} wrap="truncate-end">
              {formatLine(record, columns)}
            </Text>
          ))
        )}
      </Box>
      {draft !== null ? (
        <Text>
          <Text color="cyan">{"Search: "}</Text>
          {draft}
          <Text inverse> </Text>
          <Text dimColor>{"  Enter apply · Esc cancel"}</Text>
        </Text>
      ) : phase.kind === "error" && records.length > 0 ? (
        <Text
          color="red"
          wrap="truncate-end"
        >{`Live feed stopped: ${phase.message} — press r to resume`}</Text>
      ) : (
        <Text dimColor wrap="truncate-end">
          ↑↓/PgUp/PgDn scroll · g/G top/bottom · 1-4 level (verbose/info/warn/error) · / search · c
          clear
        </Text>
      )}
    </Box>
  );
}
