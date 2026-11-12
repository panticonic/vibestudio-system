/** The fixed sequence of the brief: read, collapse, judge each group, assemble. Only the judgment of a group is natural language. */
import gather from "./gather.js";
import condense from "./condense.js";
import assemble from "./assemble.js";
import classify from "./classify.nl";
import type { LogBrief, LogClass, LogRequest } from "../types.js";

export default async function collect(request: LogRequest): Promise<LogBrief> {
  const snapshot = await gather(request);
  const groups = condense(snapshot.records);
  const classes: LogClass[] = await Promise.all(groups.map((group) => classify(group)));
  return assemble(snapshot, groups, classes);
}
