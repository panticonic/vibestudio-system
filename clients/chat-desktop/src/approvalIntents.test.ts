import { describe, expect, it, vi } from "vitest";
import type { ApprovalsClient } from "@workspace/approvals-core";
import type { ApprovalCardIntent } from "@workspace/client-kit-web";
import type { PendingApproval } from "@vibestudio/shared/approvals";
import { answerApproval } from "./approvalIntents";

function fakeApprovals() {
  return {
    resolve: vi.fn(async () => {}),
    resolveInstallReview: vi.fn(async () => ({})),
    resolveTaskRules: vi.fn(async () => {}),
    submitClientConfig: vi.fn(async () => {}),
    submitCredentialInput: vi.fn(async () => {}),
    submitSecretInput: vi.fn(async () => {}),
  };
}

const capability = { approvalId: "a1", kind: "capability" } as unknown as PendingApproval;
const taskRules = { approvalId: "a1", kind: "capability", cardType: "task.rules" } as unknown as PendingApproval;

const intent = (body: object): ApprovalCardIntent => ({ approvalId: "a1", ...body }) as ApprovalCardIntent;

describe("answerApproval", () => {
  it("records a decision and a dismissed device code on the queue", async () => {
    const approvals = fakeApprovals();
    await answerApproval(approvals as unknown as ApprovalsClient, capability, intent({ type: "decide", decision: "once" }));
    await answerApproval(approvals as unknown as ApprovalsClient, capability, intent({ type: "device-cancel" }));
    expect(approvals.resolve).toHaveBeenNthCalledWith(1, "a1", "once");
    expect(approvals.resolve).toHaveBeenNthCalledWith(2, "a1", "dismiss");
  });

  it("submits protected input through its typed method", async () => {
    const approvals = fakeApprovals();
    const client = approvals as unknown as ApprovalsClient;
    await answerApproval(client, capability, intent({ type: "submit-secret-input", values: { k: "v" } }));
    expect(approvals.submitSecretInput).toHaveBeenCalledWith("a1", { k: "v" });
    await answerApproval(client, capability, intent({ type: "submit-client-config", values: { c: "1" } }));
    expect(approvals.submitClientConfig).toHaveBeenCalledWith("a1", { c: "1" });
  });

  it("answers task rules only on a task.rules card", async () => {
    const approvals = fakeApprovals();
    const client = approvals as unknown as ApprovalsClient;
    const resolution = { decision: "accept", selected: ["r1"] };
    await answerApproval(client, capability, intent({ type: "resolve-task-rules", resolution }));
    expect(approvals.resolveTaskRules).not.toHaveBeenCalled();
    await answerApproval(client, taskRules, intent({ type: "resolve-task-rules", resolution }));
    expect(approvals.resolveTaskRules).toHaveBeenCalledWith("a1", resolution);
  });

  it("never answers for a different approval than the one on screen", async () => {
    const approvals = fakeApprovals();
    await answerApproval(
      approvals as unknown as ApprovalsClient,
      capability,
      { approvalId: "other", type: "decide", decision: "once" }
    );
    expect(approvals.resolve).not.toHaveBeenCalled();
  });

  it("refuses in words what this window cannot do", async () => {
    const approvals = fakeApprovals();
    const client = approvals as unknown as ApprovalsClient;
    await expect(answerApproval(client, capability, intent({ type: "show-panel" }))).rejects.toThrow(
      /cannot open panels/
    );
    await expect(
      answerApproval(client, capability, intent({ type: "resolve-install-review", resolution: {} }))
    ).rejects.toThrow(/browser/);
  });

  it("propagates a failed answer to the caller", async () => {
    const approvals = fakeApprovals();
    approvals.resolve.mockRejectedValue(new Error("denied by server"));
    await expect(
      answerApproval(approvals as unknown as ApprovalsClient, capability, intent({ type: "decide", decision: "once" }))
    ).rejects.toThrow("denied by server");
  });
});
