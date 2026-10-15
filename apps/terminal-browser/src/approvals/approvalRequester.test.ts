import { describe, expect, it } from "vitest";
import type { ApprovalRequesterIdentity, PendingApproval } from "@vibestudio/shared/approvals";
import { approvalRequestedBy } from "./approvalRequester.js";

const APP = "app:terminal-apps/chat:1";
const AGENT = "do:agents/chat:ChatAgent:1";

function approval(callerId: string, requester?: Partial<ApprovalRequesterIdentity>): PendingApproval {
  return {
    kind: "capability",
    approvalId: "a",
    callerId,
    callerKind: "do",
    repoPath: "agents/chat",
    effectiveVersion: "ev",
    requestedAt: 1,
    capability: "native.shell.execute",
    title: "Run a command",
    ...(requester
      ? {
          requester: {
            id: callerId,
            kind: "do",
            category: "agent",
            repoPath: "agents/chat",
            effectiveVersion: "ev",
            stableIdentityKey: "agents/chat@ev",
            ephemeralInstanceKey: callerId,
            breadcrumbs: [],
            ...requester,
          },
        }
      : {}),
  };
}

describe("approvalRequestedBy", () => {
  it("matches the app's own principal as caller", () => {
    expect(approvalRequestedBy(approval(APP), APP)).toBe(true);
  });

  it("matches work the app started through its owning panel", () => {
    expect(approvalRequestedBy(approval(AGENT, { panel: { id: APP } }), APP)).toBe(true);
  });

  it("matches work the app started through the requester's lineage", () => {
    const raised = approval(AGENT, {
      breadcrumbs: [
        { id: APP, kind: "app", category: "workspace-app" },
        { id: AGENT, kind: "do", category: "agent" },
      ],
    });
    expect(approvalRequestedBy(raised, APP)).toBe(true);
  });

  it("does not match another app's work or a tab without a principal", () => {
    const raised = approval(AGENT, {
      panel: { id: "panel:other" },
      breadcrumbs: [{ id: "panel:other", kind: "panel", category: "panel" }],
    });
    expect(approvalRequestedBy(raised, APP)).toBe(false);
    expect(approvalRequestedBy(approval(APP), undefined)).toBe(false);
  });
});
