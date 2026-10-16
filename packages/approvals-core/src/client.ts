import { createTypedRpcServiceClient } from "@vibestudio/shared/typedRpcServiceClient";
import type { RpcClient } from "@vibestudio/rpc";
import type { ApprovalDecisionId } from "@vibestudio/shared/approvalContract";
import type { PendingApproval } from "@vibestudio/shared/approvals";
import type { TemplateInstallResolution } from "@vibestudio/shared/authority/unitInstallReview";
import type { InstallReviewResolution } from "@vibestudio/service-schemas/shellApproval";
import { SHELL_APPROVAL_PENDING_CHANGED_EVENT } from "@vibestudio/shell-core/approvalState";
import { EventsClient } from "@vibestudio/service-schemas/clients/eventsClient";
import type { TaskRulesResolution } from "./taskRulesNav.js";
import { shellApprovalMethods } from "@vibestudio/service-schemas/shellApproval";
import {
  observeDurableProjection,
  type DurableObservation,
} from "@vibestudio/shell-core/durableObservation";

/**
 * Thin wrapper over the existing global shell-approval queue. The terminal
 * browser is just a new presentation of the same queue the Electron shell uses
 * (`ConsentApprovalBar`), so decisions made here are authoritative everywhere.
 */
export interface ApprovalsClient {
  list(): Promise<PendingApproval[]>;
  resolve(approvalId: string, decision: ApprovalDecisionId): Promise<void>;
  /**
   * The only valid resolution for a `unit-install-review` approval (§8 of
   * docs/template-install-unit-approval-ux-plan.md): it carries the per-part
   * `allowNow` selection the review offered, never a bare decision id, so
   * `resolve` above cannot be used for this approval kind.
   *
   * Returns what actually happened — which parts landed, which failed, and
   * whether the workspace was left unchanged — because the surface that gave the
   * answer is the one that has to be able to say what came of it, including
   * that nothing did.
   */
  resolveInstallReview(
    approvalId: string,
    resolution: TemplateInstallResolution
  ): Promise<InstallReviewResolution>;
  /** The only valid resolution for a `task.rules` card: the exact offered rows the person selected. */
  resolveTaskRules(approvalId: string, resolution: TaskRulesResolution): Promise<void>;
  submitClientConfig(approvalId: string, values: Record<string, string>): Promise<void>;
  submitCredentialInput(approvalId: string, values: Record<string, string>): Promise<void>;
  submitSecretInput(approvalId: string, values: Record<string, string>): Promise<void>;
  /** Own the watched, authoritative queue projection through retirement. */
  observe(
    changed: (pending: PendingApproval[]) => void,
    error: (error: unknown) => void
  ): DurableObservation;
}

export function createApprovalsClient(rpc: RpcClient): ApprovalsClient {
  const shellApproval = createTypedRpcServiceClient(
    rpc,
    { targetId: "main", namespace: "shellApproval" },
    shellApprovalMethods
  );
  const events = new EventsClient(rpc);
  return {
    async list() {
      const pending = await shellApproval.listPending();
      return Array.isArray(pending) ? pending : [];
    },
    async resolve(approvalId, decision) {
      await shellApproval.resolve(approvalId, decision);
    },
    async resolveInstallReview(approvalId, resolution) {
      return await shellApproval.resolveInstallReview(approvalId, resolution);
    },
    async resolveTaskRules(approvalId, resolution) {
      await shellApproval.resolveTaskRules(approvalId, resolution);
    },
    submitClientConfig: (id, values) => shellApproval.submitClientConfig(id, values),
    submitCredentialInput: (id, values) => shellApproval.submitCredentialInput(id, values),
    submitSecretInput: (id, values) => shellApproval.submitSecretInput(id, values),
    observe(changed, error) {
      return observeDurableProjection({
        listen: (invalidate) => events.on(SHELL_APPROVAL_PENDING_CHANGED_EVENT, invalidate),
        admit: () => events.subscribe(SHELL_APPROVAL_PENDING_CHANGED_EVENT),
        leave: () => events.unsubscribe(SHELL_APPROVAL_PENDING_CHANGED_EVENT),
        read: () => shellApproval.listPending(),
        apply: changed,
        error,
      });
    },
  };
}
