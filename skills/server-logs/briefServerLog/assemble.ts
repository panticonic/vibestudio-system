/** Build the brief from what was read and what was judged, with the identity, counts and headline taken from the data, not retyped. */
import type { Finding, LogBrief, LogClass, LogGroup, LogSnapshot } from "../types.js";

export default function assemble(
  snapshot: LogSnapshot,
  groups: LogGroup[],
  classes: LogClass[]
): LogBrief {
  if (classes.length !== groups.length) {
    throw new Error(
      `assemble needs one class per group: ${groups.length} groups, ${classes.length} classes`
    );
  }
  const findings: Finding[] = [];
  groups.forEach((group, index) => {
    const judged = classes[index];
    if (judged === "notable" || judged === "failure") {
      findings.push({
        class: judged,
        level: group.level,
        ...(group.tag === undefined ? {} : { tag: group.tag }),
        message: group.message,
        count: group.count,
        firstSeq: group.firstSeq,
        lastSeq: group.lastSeq,
      });
    }
  });
  findings.sort(
    (a, b) =>
      Number(b.class === "failure") - Number(a.class === "failure") || a.firstSeq - b.firstSeq
  );
  const seqs = snapshot.records.map((record) => record.seq);
  const failures = findings.filter((finding) => finding.class === "failure").length;
  const notable = findings.length - failures;
  const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;
  return {
    serverBootId: snapshot.serverBootId,
    latestSeq: snapshot.latestSeq,
    window: {
      fromSeq: seqs[0] ?? snapshot.latestSeq,
      toSeq: seqs[seqs.length - 1] ?? snapshot.latestSeq,
      records: seqs.length,
    },
    status: failures ? "incident" : notable ? "attention" : "normal",
    headline: findings.length
      ? `${plural(failures, "failure")} and ${plural(notable, "notable group")} in ${plural(seqs.length, "line")} of the host log.`
      : `No notable events in ${plural(seqs.length, "line")} of the host log.`,
    findings,
  };
}
