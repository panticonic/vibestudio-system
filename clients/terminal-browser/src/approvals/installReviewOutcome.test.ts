import { describe, expect, it } from "vitest";
import type { InstallReviewResolution } from "@vibestudio/service-schemas/shellApproval";
import { installReviewOutcomeLines } from "./installReviewOutcome.js";

const outcome: InstallReviewResolution = {
  approvalId: "review",
  mode: "install",
  decision: "accepted",
  heading: "Adding News",
  parts: [
    {
      identityKey: "news@version",
      title: "News",
      kind: "panel",
      label: "Panel",
      clearance: "asks-when-needed",
    },
  ],
};
describe("install review outcome", () => {
  it("distinguishes accepted decisions from unreported completion", () => {
    expect(installReviewOutcomeLines(outcome)).toEqual([
      "Adding News",
      "News (Panel): asks when needed",
      "Completion was not reported; the decision does not establish that the operation finished.",
    ]);
  });
  it("retains named failures and states unchanged only when explicitly proven", () => {
    const lines = installReviewOutcomeLines({
      ...outcome,
      heading: "News was not added",
      landing: {
        landed: [],
        failed: [{ identityKey: "news@version", title: "News", reason: "provider disconnected" }],
        workspaceUnchanged: false,
      },
    });
    expect(lines).toContain("Did not land: News — provider disconnected");
    expect(lines).not.toContain("Workspace unchanged.");
    expect(
      installReviewOutcomeLines({
        ...outcome,
        decision: "cancelled",
        landing: { landed: [], failed: [], workspaceUnchanged: true },
      })
    ).toContain("Workspace unchanged.");
  });
});
