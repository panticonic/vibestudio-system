/**
 * What the presentational approval surfaces say to their host. The card renders
 * with no RPC (in the desktop it lives in the content-overlay, a separate
 * document); it emits `ApprovalCardIntent`s up and the chrome coordinator runs
 * the matching call. Pure derivations over an approval (tone, caller, queue
 * position, diff payload) are the headless core's (`@workspace/approvals-core`).
 */
import type { ApprovalDecision, PendingApproval } from "@vibestudio/shared/approvals";
import type { TemplateInstallResolution } from "@vibestudio/shared/authority/unitInstallReview";
import type { DiffChangedFile } from "@workspace/ui/diff";

/**
 * Intents the presentational card emits up to its host. In the overlay these
 * cross the process boundary (surface → main → chrome) as opaque payloads; the
 * chrome coordinator runs the matching RPC handler.
 */
export type ApprovalCardIntentBody =
  | { type: "decide"; decision: ApprovalDecision }
  | {
      /**
       * Accept an install review with exactly what the user checked, or cancel
       * it. Every part arrives either way — this decides only what is allowed
       * now and what asks when it is needed.
       */
      type: "resolve-install-review";
      resolution: TemplateInstallResolution;
    }
  | {
      type: "resolve-task-rules";
      resolution: { decision: "accept"; selected: string[] } | { decision: "cancel" };
    }
  | { type: "submit-client-config"; values: Record<string, string> }
  | { type: "submit-credential-input"; values: Record<string, string> }
  | { type: "submit-secret-input"; values: Record<string, string> }
  | { type: "device-cancel" }
  | { type: "minimize" }
  | { type: "browse"; dir: "prev" | "next" }
  | { type: "show-panel" }
  // Diff-review (P3.5): the overlay surface has no RPC, so the presentational
  // card asks the chrome coordinator to fetch a payload blob by content hash,
  // and the result comes back down as an updated `blobResults` prop.
  | { type: "fetch-blob"; hash: string; refresh?: boolean }
  // Diff-review escape hatch: the reviewer wants to inspect a file in the
  // Workspace History (the only surface with a real file-inspection view).
  // The chrome coordinator opens/focuses it with this target as
  // launch state-args. Emitted both for degraded (binary/oversized) rows and
  // as a quiet secondary action on normal file headers.
  | { type: "open-in-workspace-history"; target: WorkspaceHistoryTarget };
export type ApprovalCardIntent = {
  approvalId: string;
  presentationKey?: string;
} & ApprovalCardIntentBody;

/**
 * Deep-link target for the "open in Workspace History" escape hatch. Carries the
 * repo + focused path + the two content hashes and two tree states named in the
 * diff-review payload, so Workspace History can render a real two-state
 * compare view for the file. `files` carries the entry's whole changed-file set
 * so the panel can step across every file the reviewer was sent for; `binary` /
 * `tooLarge` mirror the host degrade flags of the focused file. Mirrors the
 * per-file fields of a `DiffReviewEntry` (and the panel's `DiffTarget`).
 */
export interface WorkspaceHistoryTarget {
  repoPath: string;
  path: string;
  oldHash?: string;
  newHash?: string;
  oldState: string;
  newState: string | null;
  /** Host-flagged binary/oversized focused file → diffstat-only in the panel. */
  binary?: boolean;
  tooLarge?: boolean;
  /** Every changed file of the source entry (includes the focused `path`). */
  files?: DiffChangedFile[];
}

/**
 * Result of one chrome-side blob fetch, pushed back down to the overlay surface.
 * `text` is the decoded blob; a `null`-shaped result is either a missing blob or
 * a fetch error (both degrade non-blockingly in the viewer).
 */
export type BlobResult = { text: string } | { missing: true } | { error: string };

/**
 * Which approvals open on the full surface rather than in the floating card
 * (docs/template-install-unit-approval-ux-plan.md §7.2, §7.8).
 *
 * The content overlay is notification-shaped by construction: the host caps it
 * far below the window and floats it in a corner of the panel region. That is
 * the right shape for "may I open this URL" and the wrong one for a review whose
 * list IS the decision — the creation review carries every part of a fresh
 * workspace, and a two-pane review at 1100×720 is what §7.2 specifies. So the
 * kind decides the host: a unit install review is shown in a window-sized dialog
 * the chrome owns, and everything else keeps the floating card.
 *
 * This is a property of the approval, not of the window: a small window collapses
 * the dialog to the list/detail model, it does not demote the review back into a
 * notification.
 */
export function approvalOpensFullSurface(approval: PendingApproval): boolean {
  return approval.kind === "unit-install-review";
}
