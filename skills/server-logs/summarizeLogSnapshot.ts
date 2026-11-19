import assemble from "./briefServerLog/assemble.js";
import condense from "./briefServerLog/condense.js";
import classify from "./classifyHostLogGroup.nl";
import type { LogBrief, LogSnapshot } from "./types.js";

/** Group and classify the records of an already-observed window. */
export default async function summarizeLogSnapshot(
  snapshot: LogSnapshot,
): Promise<LogBrief> {
  const groups = condense(snapshot.records);
  const classes = await Promise.all(groups.map((group) => classify(group)));
  return assemble(snapshot, groups, classes);
}
