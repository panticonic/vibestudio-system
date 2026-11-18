import type { LocalTaskReport } from "../local-model-task/types.js";
import type { LocalTaskFixtureOperation } from "./fixture.js";
import type { LocalTaskWorld } from "./worlds.js";

export function verifyLocalModelTask(
  world: LocalTaskWorld,
  report: LocalTaskReport,
  operations: readonly LocalTaskFixtureOperation[],
) {
  const expected = world.expected;
  const checks = {
    disposition: report.disposition === expected.disposition,
    model: report.ref === expected.ref && report.state === expected.state,
    receipt:
      expected.receipt === null
        ? report.receipt === null
        : report.receipt?.kind === expected.receipt.kind &&
          report.receipt?.ref === expected.receipt.ref &&
          (expected.receipt.kind !== "installed" ||
            (report.receipt.kind === "installed" &&
              report.receipt.jobId === expected.receipt.jobId)),
    handoff:
      expected.handoff === null
        ? report.handoff === null
        : report.handoff?.ref === expected.handoff.ref &&
          report.handoff?.mode === expected.handoff.mode,
    extensionJournal:
      operations.length === world.expectedOperations.length &&
      operations.every(
        (operation, index) => operation === world.expectedOperations[index],
      ),
  };
  return { passed: Object.values(checks).every(Boolean), checks };
}
