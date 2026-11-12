/** Read one bounded window of the host log, with the identity of the boot it came from. */
import { serverLog } from "natlang:services";
import type { LogRequest, LogSnapshot } from "../types.js";

/** The service keeps the most recent matches; this many lines are enough to see an incident and cheap to group. */
const WINDOW = 300;

export default async function gather(request: LogRequest): Promise<LogSnapshot> {
  const filtered = request.since !== undefined || request.level !== undefined;
  const [read, stats] = await Promise.all([
    filtered
      ? serverLog.query({ since: request.since, level: request.level, limit: WINDOW })
      : serverLog.tail(WINDOW),
    serverLog.stats(),
  ]);
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
