import type { ApprovalRequesterIdentity, PendingApproval } from "@vibestudio/shared/approvals";

/**
 * Whether an approval belongs to the terminal app whose runtime principal is
 * `principalId`: raised by the app or by work it started, or holding up such
 * work that joined it (an agent parked on a review that was already open).
 *
 * The app's agents and workers run under their own principals, so the caller
 * alone misses them; the host attributes every requester to its owning panel
 * and to the full runtime lineage (`requester.panel`, `requester.breadcrumbs`),
 * and the app's principal appears there. The one predicate behind a tab's
 * badge, the overlay opening by itself, and its "(this tab)" origin.
 */
export function approvalRequestedBy(
  approval: PendingApproval,
  principalId: string | undefined
): boolean {
  if (principalId === undefined) return false;
  if (approval.callerId === principalId) return true;
  if (approval.requester && startedBy(approval.requester, principalId)) return true;
  return (
    approval.kind === "unit-install-review" &&
    (approval.waiting ?? []).some((waiter) => startedBy(waiter, principalId))
  );
}

function startedBy(requester: ApprovalRequesterIdentity, principalId: string): boolean {
  return (
    requester.id === principalId ||
    requester.panel?.id === principalId ||
    requester.breadcrumbs.some((breadcrumb) => breadcrumb.id === principalId)
  );
}
