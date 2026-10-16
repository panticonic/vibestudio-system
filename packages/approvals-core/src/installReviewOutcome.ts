import type { InstallReviewResolution } from "@vibestudio/service-schemas/shellApproval";
import { HOST_APPROVAL_COPY } from "@vibestudio/shared/hostApprovalCopy";
import type { PendingUnitInstallReviewApproval } from "./installSelection.js";

const COPY = HOST_APPROVAL_COPY.installReview;

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

/**
 * What an install review's outcome is about: the authoritative service's
 * resolution, or the service refusing the answer. Both are one thing to the
 * reader ("what came of that?"), so every surface presents them through one model.
 */
export type InstallReviewOutcome =
  | {
      source: "refused";
      mode: PendingUnitInstallReviewApproval["mode"];
      message: string;
    }
  | { source: "resolved"; resolution: InstallReviewResolution };

/** What an outcome notice renders, resolved from either kind of outcome. */
export interface InstallOutcomeModel {
  /**
   * Success is claimed only on evidence. Accepted-with-no-landing is `neutral`,
   * not `success`: absent landing means "not watched", never "fine".
   */
  tone: "success" | "failure" | "neutral";
  heading: string;
  /** One supporting line: the server's, or the refusal's own message. */
  detail?: string;
  /** The template this was about, when it was about one. */
  subject?: string;
  /** Named, with reasons, never counted. */
  failed: readonly { identityKey: string; title: string; reason: string }[];
  /** The one thing that is safe to say about the aftermath, when it is. */
  aftermath?: string;
  entryPoint?: NonNullable<InstallReviewResolution["entryPoint"]>;
}

/**
 * Read an outcome as a notice will say it, never louder than the evidence:
 * nothing here invents a fact the outcome did not carry, and every branch that
 * would claim more than was observed falls back to the neutral one.
 */
export function installOutcomeModel(outcome: InstallReviewOutcome): InstallOutcomeModel {
  if (outcome.source === "refused") {
    return {
      tone: "failure",
      heading: COPY.failure.heading[outcome.mode],
      detail: outcome.message,
      failed: [],
      aftermath: COPY.failure.aftermath,
    };
  }
  const { resolution } = outcome;
  const failed = resolution.landing?.failed ?? [];
  const landed = resolution.landing != null;
  // Cancelling is a decision the person made on purpose, so it is never dressed
  // as a failure; a cancel that still left named casualties says so.
  const tone: InstallOutcomeModel["tone"] =
    failed.length > 0
      ? "failure"
      : resolution.decision === "accepted" && landed
        ? "success"
        : "neutral";
  return {
    tone,
    heading: resolution.heading,
    ...(resolution.detail ? { detail: resolution.detail } : {}),
    ...(resolution.subject ? { subject: resolution.subject } : {}),
    failed,
    ...(resolution.landing?.workspaceUnchanged
      ? { aftermath: COPY.result.workspaceUnchanged }
      : {}),
    ...(resolution.entryPoint ? { entryPoint: resolution.entryPoint } : {}),
  };
}
