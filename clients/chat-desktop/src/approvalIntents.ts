import type { ApprovalsClient } from "@workspace/approvals-core";
import type { ApprovalCardIntent } from "@workspace/client-kit-web";
import type { PendingApproval } from "@vibestudio/shared/approvals";

/**
 * Carry out what the approval card asked for on the workspace's approval queue.
 * The queue is authoritative: this only records the person's answer, and the
 * observed queue (not this function) is what retires the card.
 *
 * Intents that belong to the card's own presentation (browsing the queue,
 * minimizing) never reach here; the dock handles them. What this window cannot
 * do (it hosts no panels and has no workspace-history surface) is refused in
 * words, never silently ignored.
 */
export async function answerApproval(
  approvals: ApprovalsClient,
  approval: PendingApproval,
  intent: ApprovalCardIntent
): Promise<void> {
  if (intent.approvalId !== approval.approvalId) return;
  switch (intent.type) {
    case "decide":
      return approvals.resolve(approval.approvalId, intent.decision);
    case "device-cancel":
      return approvals.resolve(approval.approvalId, "dismiss");
    case "submit-client-config":
      return approvals.submitClientConfig(approval.approvalId, intent.values);
    case "submit-credential-input":
      return approvals.submitCredentialInput(approval.approvalId, intent.values);
    case "submit-secret-input":
      return approvals.submitSecretInput(approval.approvalId, intent.values);
    case "resolve-task-rules":
      if (approval.kind !== "capability" || approval.cardType !== "task.rules") return;
      return approvals.resolveTaskRules(approval.approvalId, intent.resolution);
    case "resolve-install-review":
      throw new Error("Reviewing an install needs the Vibestudio browser.");
    case "show-panel":
    case "open-in-workspace-history":
      throw new Error("This window cannot open panels. Use the Vibestudio browser for that.");
    case "fetch-blob":
    case "minimize":
    case "browse":
      return;
  }
}
