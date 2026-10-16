import type { InstallReviewResolution } from "@vibestudio/service-schemas/shellApproval";

/** Reports only the decision and landing evidence returned by the authoritative service. */
export function installReviewOutcomeLines(outcome: InstallReviewResolution): string[] {
  const lines = [outcome.heading, ...(outcome.detail ? [outcome.detail] : [])];
  for (const part of outcome.parts)
    lines.push(
      `${part.title} (${part.label}): ${part.clearance === "allowed-now" ? "allowed now" : "asks when needed"}`
    );
  if (!outcome.landing)
    lines.push(
      "Completion was not reported; the decision does not establish that the operation finished."
    );
  else {
    for (const part of outcome.parts)
      if (outcome.landing.landed.includes(part.identityKey)) lines.push(`Landed: ${part.title}`);
    for (const part of outcome.landing.failed)
      lines.push(`Did not land: ${part.title} — ${part.reason}`);
    if (outcome.landing.workspaceUnchanged) lines.push("Workspace unchanged.");
  }
  if (outcome.entryPoint)
    lines.push(`Open ${outcome.entryPoint.title} from the workspace launcher when available.`);
  return lines;
}
