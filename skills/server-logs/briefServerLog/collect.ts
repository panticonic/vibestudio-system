import gather from "./gather.js";
import summarizeLogSnapshot from "../summarizeLogSnapshot.js";
import type { LogBrief, LogRequest } from "../types.js";

export default async function collect(request: LogRequest): Promise<LogBrief> {
  return summarizeLogSnapshot(await gather(request));
}
