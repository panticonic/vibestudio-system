import { describe, expect, it } from "vitest";
import type { PendingApproval } from "@vibestudio/shared/approvals";
import { approvalDecisionOptions } from "./approvalDecisions.js";

const base = {
  approvalId: "a",
  callerId: "panel:chat",
  callerKind: "panel" as const,
  repoPath: "panels/chat",
  effectiveVersion: "ev",
  requestedAt: 1,
};

function decisions(approval: PendingApproval): string[] {
  return approvalDecisionOptions(approval).map((option) => option.decision);
}

describe("approvalDecisionOptions", () => {
  it("offers a critical confirmation only once and deny", () => {
    const approval: PendingApproval = {
      ...base,
      kind: "capability",
      capability: "context.boundary",
      title: "Cross a boundary",
      cardType: "confirm.critical",
      allowedDecisions: ["once", "deny"],
    };
    expect(approvalDecisionOptions(approval)).toEqual([
      { decision: "once", label: "Confirm" },
      { decision: "deny", label: "Cancel" },
    ]);
  });

  it("follows a capability's allowedDecisions in their offered order", () => {
    const approval: PendingApproval = {
      ...base,
      kind: "capability",
      capability: "server-logs.read",
      title: "Read logs",
      allowedDecisions: ["once", "session", "deny"],
    };
    expect(decisions(approval)).toEqual(["once", "session", "deny"]);
  });

  it("offers a browser permission the host's own decisions for its capabilities", () => {
    const approval = {
      ...base,
      kind: "browser-permission",
      ownerUserId: "u",
      workspaceId: "w",
      environmentKey: "e",
      panelId: "panel:browser",
      origin: "https://example.com",
      topLevelUrl: "https://example.com/",
      capabilities: ["screen-capture"],
      deviceLabel: "Laptop",
    } as PendingApproval;
    expect(decisions(approval)).toEqual(["once", "block", "dismiss"]);
  });

  it("can only decline an approval that needs input entered elsewhere", () => {
    const approval = {
      ...base,
      kind: "secret-input",
      title: "API key",
    } as unknown as PendingApproval;
    expect(decisions(approval)).toEqual(["deny"]);
  });
});
