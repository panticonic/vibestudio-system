/** Pure log-view model: filtering, windowing and formatting, independent of Ink. */

export type LogLevel = "verbose" | "info" | "warn" | "error";
export const LOG_LEVELS: readonly LogLevel[] = ["verbose", "info", "warn", "error"];

export interface LogRecord {
  seq: number;
  timestamp: number;
  level: LogLevel;
  tag?: string;
  message: string;
}

/** How many records the view keeps in memory; older ones are still queryable on the server. */
export const MAX_RECORDS = 5000;

export interface LogFilter {
  minLevel: LogLevel;
  search: string;
}

export const DEFAULT_FILTER: LogFilter = { minLevel: "info", search: "" };

/** Append a batch, deduplicating by `seq` (live events can overlap the initial tail). */
export function appendRecords(
  current: readonly LogRecord[],
  batch: readonly LogRecord[]
): LogRecord[] {
  const lastSeq = current.length > 0 ? current[current.length - 1]!.seq : -1;
  const fresh = batch.filter((record) => record.seq > lastSeq).sort((a, b) => a.seq - b.seq);
  if (fresh.length === 0) return current as LogRecord[];
  const next = [...current, ...fresh];
  return next.length > MAX_RECORDS ? next.slice(next.length - MAX_RECORDS) : next;
}

export function matches(record: LogRecord, filter: LogFilter): boolean {
  if (LOG_LEVELS.indexOf(record.level) < LOG_LEVELS.indexOf(filter.minLevel)) return false;
  if (!filter.search) return true;
  const needle = filter.search.toLowerCase();
  return (
    record.message.toLowerCase().includes(needle) ||
    (record.tag?.toLowerCase().includes(needle) ?? false)
  );
}

/**
 * The visible slice of `records` for a viewport of `height` lines, scrolled
 * `offset` lines up from the newest (0 = following the tail).
 */
export function visibleWindow<T>(
  records: readonly T[],
  height: number,
  offset: number
): {
  rows: T[];
  offset: number;
} {
  const maxOffset = Math.max(0, records.length - height);
  const clamped = Math.min(Math.max(0, offset), maxOffset);
  const end = records.length - clamped;
  return { rows: records.slice(Math.max(0, end - height), end), offset: clamped };
}

export function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** One log line, flattened and cut to the viewport width (no wrapping keeps scroll math exact). */
export function formatLine(record: LogRecord, width: number): string {
  const tag = record.tag ? `[${record.tag}] ` : "";
  // eslint-disable-next-line no-control-regex
  const message = record.message.replace(/[\x00-\x1f\x7f]+/g, " ");
  const line = `${formatTime(record.timestamp)} ${record.level.slice(0, 4).padEnd(4)} ${tag}${message}`;
  return line.length > width ? `${line.slice(0, Math.max(0, width - 1))}…` : line;
}
