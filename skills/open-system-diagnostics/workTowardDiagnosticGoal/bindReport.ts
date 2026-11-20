import type { DiagnosticDecision, DiagnosticReport, Inspection } from "../types.js";

export default function bindReport(decision: DiagnosticDecision, inspected: Inspection[]): DiagnosticReport {
  const windows = new Map(inspected.map(({ window }) => [window.source.id, window]));
  const evidence = decision.evidence.map(({ sourceId, seq }) => {
    const found = windows.get(sourceId);
    const record = found?.records.find((item) => item.seq === seq);
    if (found?.status !== "observed" || !record)
      throw new Error("The incident citation is outside the observed retained window");
    return { sourceId, boot: found.liveBoot, seq, text: record.text };
  });
  if (new Set(evidence.map(({ sourceId, seq }) => `${sourceId}:${seq}`)).size !== evidence.length)
    throw new Error("Cite each diagnostic observation at most once");
  return {
    finding: { status: decision.status, reason: decision.reason, citations: evidence },
    coverage: inspected.map(({ window }) => ({
      sourceId: window.source.id, status: window.status, liveBoot: window.liveBoot, through: window.through,
    })),
    artifact: null,
  };
}
