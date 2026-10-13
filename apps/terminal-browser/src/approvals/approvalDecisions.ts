import type { ApprovalDecisionId } from "@vibestudio/shared/approvalContract";
import { browserPermissionDecisions, type PendingApproval } from "@vibestudio/shared/approvals";
import { getStandardApprovalDecisionActions } from "@vibestudio/shared/approvalCopy";
import { HOST_APPROVAL_COPY } from "@vibestudio/shared/hostApprovalCopy";

/** One decision the focused approval accepts, with the words every surface uses for it. */
export interface ApprovalDecisionOption {
  decision: ApprovalDecisionId;
  label: string;
}

/**
 * The decisions an approval accepts through `shellApproval.resolve`, in the
 * order they are offered — the overlay numbers them `[1]`, `[2]`, … and a
 * digit picks the option at that position, so a key never names a decision
 * the host would refuse (a critical confirmation accepts only once/deny).
 *
 * Standard capability and credential requests take the host-derived
 * `allowedDecisions` through the same projection the desktop card and push
 * notifications use; a browser site permission takes the host's own decision
 * set for its capabilities. The input-requiring kinds (a form, a secret, a
 * device code) can only be answered where that input can be entered, so a
 * terminal can only decline them. A `unit-install-review` resolves through
 * `resolveInstallReview` instead and has no options here.
 */
export function approvalDecisionOptions(approval: PendingApproval): ApprovalDecisionOption[] {
  switch (approval.kind) {
    case "capability":
    case "credential":
      return getStandardApprovalDecisionActions(approval).map(({ decision, label }) => ({
        decision,
        label,
      }));
    case "browser-permission": {
      const copy: Partial<Record<ApprovalDecisionId, { label: string }>> =
        HOST_APPROVAL_COPY.actions.browserPermission;
      return browserPermissionDecisions(approval.capabilities).map((decision) => ({
        decision,
        label: copy[decision]?.label ?? decision,
      }));
    }
    case "unit-install-review":
      return [];
    default:
      return [{ decision: "deny", label: HOST_APPROVAL_COPY.pushActions.deny }];
  }
}
