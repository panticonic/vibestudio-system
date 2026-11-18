import type { SystemClientEvidence, SystemClientInput } from "../../types.js";

export default function selectAttempt(
  input: SystemClientInput,
): SystemClientEvidence[] {
  return input.checks.filter((check) => check.revision === input.revision);
}
