import { describe, expect, it } from "vitest";
import type { PendingApproval } from "@vibestudio/shared/approvals";
import {
  approvalAccent,
  approvalQueueInfo,
  diffReviewPayloadHashes,
  getDiffReviewPayload,
  highestPendingTone,
  truncateId,
} from "./cardModel.js";

const base = {
  approvalId: "a",
  callerId: "panel:x",
  callerKind: "panel" as const,
  repoPath: "meta",
  effectiveVersion: "ev",
  requestedAt: 1,
};
const capability = (severity?: "standard" | "severe"): PendingApproval => ({
  ...base,
  kind: "capability",
  capability: "x.y",
  title: "T",
  ...(severity ? { severity } : {}),
});

describe("approval card model", () => {
  it("lets a severe request outrank a calmer one in the queue's tone", () => {
    expect(approvalAccent(capability("severe"))).toBe("red");
    expect(highestPendingTone([capability(), capability("severe"), capability()])).toBe("red");
    expect(highestPendingTone([capability()])).toBe("info");
  });

  it("offers browsing only when there is more than one", () => {
    expect(approvalQueueInfo(0, 1)).toBeNull();
    expect(approvalQueueInfo(0, 3)).toEqual({ index: 0, total: 3, canPrev: false, canNext: true });
  });

  it("reads a diff-review payload only when well formed, and bounds fetchable hashes to it", () => {
    const entry = {
      repoPath: "meta",
      oldState: "o",
      newState: "n",
      diffStat: { filesChanged: 1 },
      changedFiles: [{ path: "a", kind: "changed", oldHash: "h1", newHash: "h2" }],
    };
    const ok = { ...capability(), diffReview: [entry] } as PendingApproval;
    expect(getDiffReviewPayload(ok)).toHaveLength(1);
    expect([...diffReviewPayloadHashes(getDiffReviewPayload(ok)!)]).toEqual(["h1", "h2"]);
    const malformed = { ...capability(), diffReview: [{ repoPath: 1 }] } as unknown as PendingApproval;
    expect(getDiffReviewPayload(malformed)).toBeNull();
    expect(getDiffReviewPayload(capability())).toBeNull();
  });

  it("shortens long ids but not short ones", () => {
    expect(truncateId("abcdefghijklmnop")).toBe("abcdefgh…mnop");
    expect(truncateId("short")).toBe("short");
  });
});
