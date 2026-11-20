/** Read one bounded window of the host log, with the identity of the boot it came from. */
import { serverLog } from "natlang:services";
import type { LogRequest, LogSnapshot } from "../types.js";

/** The service keeps the most recent matches; this many lines are enough to see an incident and cheap to group. */
const WINDOW = 300;

export default async function gather(request: LogRequest): Promise<LogSnapshot> {
  const { bounds, since, level, tag } = request;
  if (bounds && (!Number.isSafeInteger(bounds.after) || bounds.after < 0 ||
    !Number.isSafeInteger(bounds.through) || bounds.through <= bounds.after)) {
    throw new Error("Host log windows require increasing nonnegative sequence bounds.");
  }
  const filtered = bounds || since !== undefined || level !== undefined || tag !== undefined;
  const [read, stats] = await Promise.all([
    filtered
      ? serverLog.query({
        ...(bounds ? { sinceSeq: bounds.after, untilSeq: bounds.through } : {}),
        since, level, tag, limit: bounds ? WINDOW + 1 : WINDOW,
      })
      : serverLog.tail(WINDOW),
    serverLog.stats(),
  ]);
  if (bounds && (read.latestSeq < bounds.through ||
    (stats.oldestSeq !== null && stats.oldestSeq > bounds.after + 1) ||
    read.records.length > WINDOW)) {
    throw new Error("The fixed host log window is unavailable or exceeds 300 matches. Read a narrower retained window.");
  }
  return {
    serverBootId: read.serverBootId,
    latestSeq: read.latestSeq,
    records: read.records.map(({ seq, timestamp, level, tag, message, pid }) => ({
      seq,
      timestamp,
      level,
      tag,
      message,
      pid,
    })),
    totalCaptured: stats.totalCaptured,
  };
}
