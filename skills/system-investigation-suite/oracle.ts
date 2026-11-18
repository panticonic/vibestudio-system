import type { SystemInvestigationReport } from "../system-investigation/types.js";
import type { SystemInvestigationWorld } from "./worlds.js";

/** Match the independent task contract against the report, preserving exact evidence identity. */
export function verifySystemInvestigation(
  world: SystemInvestigationWorld,
  candidate: SystemInvestigationReport,
) {
  const expected = world.expected.findings;
  const actual = candidate.findings;
  const checks = {
    status: candidate.status === world.expected.status,
    findings:
      actual.length === expected.length &&
      expected.every(({ code }, index) => actual[index]?.code === code),
    evidence: expected.every(({ evidenceIds }, index) => {
      const cited = actual[index]?.evidenceIds;
      return (
        cited !== undefined &&
        cited.length === evidenceIds.length &&
        new Set(cited).size === cited.length &&
        evidenceIds.every((id) => cited.includes(id))
      );
    }),
  };
  return { passed: Object.values(checks).every(Boolean), checks };
}
