import type { SystemBootstrapAudit } from "../../../types.js";

export default function findPrimary(
  evidence: SystemBootstrapAudit,
): SystemBootstrapAudit["artifacts"] {
  return evidence.artifacts.filter(
    (artifact) =>
      artifact.platform === evidence.platform && artifact.role === "primary",
  );
}
