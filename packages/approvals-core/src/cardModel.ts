/**
 * Pure derivations every approval surface shares: risk tone, caller, queue
 * position, the requester's lineage, and the diff-review payload. No UI, no RPC.
 */
import type { DiffReviewEntry, PendingApproval } from "@vibestudio/shared/approvals";
import {
  getApprovalCallerPresentation,
  getApprovalRiskTone,
  getRequesterCategoryLabel,
  type ApprovalCallerPresentation,
} from "@vibestudio/shared/approvalCopy";

export type CallerInfo = ApprovalCallerPresentation;

/** Risk tone → accent token key. */
export type ApprovalTone = "info" | "amber" | "red";

/** Browse position for the queue navigator (absent when there is a single approval). */
export interface ApprovalQueueInfo {
  index: number;
  total: number;
  canPrev: boolean;
  canNext: boolean;
}

export function approvalQueueInfo(index: number, total: number): ApprovalQueueInfo | null {
  if (total <= 1) return null;
  return { index, total, canPrev: index > 0, canNext: index < total - 1 };
}

export function approvalAccent(approval: PendingApproval): ApprovalTone {
  const tone = getApprovalRiskTone(approval);
  if (tone === "danger") return "red";
  if (tone === "caution") return "amber";
  return "info";
}

/** Highest-risk tone across the pending queue, so a minimized red request can't hide behind a calmer one. */
export function highestPendingTone(pending: readonly PendingApproval[]): ApprovalTone {
  let tone: ApprovalTone = "info";
  for (const approval of pending) {
    const accent = approvalAccent(approval);
    if (accent === "red") return "red";
    if (accent === "amber") tone = "amber";
  }
  return tone;
}

/** The display-friendly caller of an approval (the host's entity-title registry, with a derived fallback). */
export function resolveCallerInfo(approval: PendingApproval): CallerInfo {
  return getApprovalCallerPresentation(approval);
}

/** The requester's lineage as one line, when it has more than one link. */
export function requesterBreadcrumbSummary(approval: PendingApproval): string | null {
  const breadcrumbs = approval.requester?.breadcrumbs ?? [];
  if (breadcrumbs.length <= 1) return null;
  return (
    breadcrumbs
      .map((breadcrumb) => {
        if (breadcrumb.category === "unknown") return breadcrumb.label;
        const kind = getRequesterCategoryLabel(breadcrumb.category);
        return breadcrumb.label ? `${kind}: ${breadcrumb.label}` : kind;
      })
      .filter(Boolean)
      .join(" > ") || null
  );
}

/** Where an eval sandbox request came from, when it came from one. */
export function evalSummary(approval: PendingApproval): string | null {
  const evalMeta = approval.requester?.eval;
  if (!evalMeta) return null;
  const parts = [
    evalMeta.ownerId ? `owner ${evalMeta.ownerId}` : null,
    evalMeta.subKey ? `scope ${evalMeta.subKey}` : null,
    evalMeta.runId ? `run ${evalMeta.runId}` : null,
  ].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(", ") : "Eval sandbox";
}

/**
 * Feature-detect the diff-review payload on an approval. Absent (every approval
 * that isn't a host main-advance / repo deletion / restore) is `null`. Present is
 * the host-computed per-repo batch; the runtime shape check guards against a
 * malformed payload over the wire.
 */
export function getDiffReviewPayload(approval: PendingApproval): DiffReviewEntry[] | null {
  const candidate = approval.diffReview;
  if (!Array.isArray(candidate) || candidate.length === 0) return null;
  const valid = candidate.every((entry) => {
    if (typeof entry !== "object" || entry === null) return false;
    const record = entry as { repoPath?: unknown; changedFiles?: unknown; diffStat?: unknown };
    if (typeof record.repoPath !== "string") return false;
    if (!Array.isArray(record.changedFiles)) return false;
    const diffStat = record.diffStat;
    if (typeof diffStat !== "object" || diffStat === null) return false;
    return typeof (diffStat as { filesChanged?: unknown }).filesChanged === "number";
  });
  return valid ? candidate : null;
}

/**
 * Every content hash the diff-review payload legitimately references. A chrome
 * fetches ONLY these hashes on a card's behalf, so a request for any other hash
 * is ignored.
 */
export function diffReviewPayloadHashes(entries: readonly DiffReviewEntry[]): Set<string> {
  const hashes = new Set<string>();
  for (const entry of entries) {
    for (const file of entry.changedFiles) {
      if (file.oldHash) hashes.add(file.oldHash);
      if (file.newHash) hashes.add(file.newHash);
    }
  }
  return hashes;
}

export function basename(path: string): string {
  if (!path) return "";
  const trimmed = path.replace(/\/+$/, "");
  const idx = trimmed.lastIndexOf("/");
  return idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
}

export function prettifyId(callerId: string): string {
  // Drop common prefixes ("do-service:", "do:", "worker:") and trim noise.
  return callerId.replace(/^(do-service:|do:|worker:|panel:)/, "");
}

export function truncateId(id: string, head = 8, tail = 4): string {
  if (id.length <= head + tail + 1) return id;
  return `${id.slice(0, head)}…${id.slice(-tail)}`;
}
