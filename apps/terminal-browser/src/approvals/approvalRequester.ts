import type { PendingApproval } from "@vibestudio/shared/approvals";

/**
 * Whether an approval was raised by the terminal app whose runtime principal
 * is `principalId`, or by work that app started.
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
  const requester = approval.requester;
  if (!requester) return false;
  return (
    requester.panel?.id === principalId ||
    requester.breadcrumbs.some((breadcrumb) => breadcrumb.id === principalId)
  );
}
