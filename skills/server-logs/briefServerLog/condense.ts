/** Collapse lines that say the same thing, so each distinct message is judged once and counted exactly. */
import type { LogGroup, LogRecord } from "../types.js";

const MESSAGE_CUT = 300;

/** The comparison key of a line: its level, tag and message with numbers, quoted text and bracketed names blurred. */
function keyOf(record: LogRecord): string {
  const blurred = record.message
    .replace(/"[^"\n]*"/g, '"_"')
    .replace(/\[[^\]\n]*\]/g, "[_]")
    .replace(/\S*(?:\d|[a-z][A-Z])\S*/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  return `${record.level}|${record.tag ?? ""}|${blurred}`;
}

export default function condense(records: LogRecord[]): LogGroup[] {
  const byKey = new Map<string, LogGroup>();
  for (const record of records) {
    const key = keyOf(record);
    const group = byKey.get(key);
    if (group) {
      group.count += 1;
      group.lastSeq = record.seq;
    } else {
      byKey.set(key, {
        id: byKey.size,
        level: record.level,
        ...(record.tag === undefined ? {} : { tag: record.tag }),
        message: record.message.slice(0, MESSAGE_CUT),
        count: 1,
        firstSeq: record.seq,
        lastSeq: record.seq,
      });
    }
  }
  return [...byKey.values()];
}
