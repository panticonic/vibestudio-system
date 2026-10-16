import { describe, expect, it, vi } from "vitest";
import type { PendingApproval } from "@vibestudio/shared/approvals";
import type { DurableObservation } from "@vibestudio/shell-core/durableObservation";
import { createApprovalQueue } from "./queue.js";

const approval = (id: string) => ({ approvalId: id, kind: "capability" }) as unknown as PendingApproval;

function fakeClient() {
  let apply!: (pending: PendingApproval[]) => void;
  let fail!: (error: unknown) => void;
  const observation: DurableObservation = {
    ready: Promise.resolve(),
    refresh: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
  };
  const client = {
    observe: vi.fn((changed: typeof apply, error: typeof fail) => {
      apply = changed;
      fail = error;
      return observation;
    }),
  };
  return { client, observation, push: (pending: PendingApproval[]) => apply(pending), fail: (e: unknown) => fail(e) };
}

describe("approval queue", () => {
  it("mirrors the authoritative queue and tells subscribers", async () => {
    const fake = fakeClient();
    const queue = createApprovalQueue(fake.client);
    const seen: number[] = [];
    queue.subscribe(() => seen.push(queue.getSnapshot().pending.length));
    expect(queue.getSnapshot().status).toBe("loading");
    await queue.start();
    fake.push([approval("a"), approval("b")]);
    fake.push([approval("b")]);
    expect(queue.getSnapshot()).toMatchObject({ status: "ready" });
    expect(seen).toEqual([2, 1]);
  });

  it("keeps the last queue visible and records a failure", async () => {
    const fake = fakeClient();
    const queue = createApprovalQueue(fake.client);
    await queue.start();
    fake.push([approval("a")]);
    fake.fail(new Error("stream broke"));
    const snapshot = queue.getSnapshot();
    expect(snapshot.status).toBe("failed");
    expect(snapshot.pending).toHaveLength(1);
  });

  it("starts once, refreshes through the observation and joins it on stop", async () => {
    const fake = fakeClient();
    const queue = createApprovalQueue(fake.client);
    await queue.start();
    await queue.start();
    expect(fake.client.observe).toHaveBeenCalledTimes(1);
    await queue.refresh();
    expect(fake.observation.refresh).toHaveBeenCalledTimes(1);
    await queue.stop();
    expect(fake.observation.stop).toHaveBeenCalledTimes(1);
    expect(() => queue.refresh()).toThrow("not been started");
  });
});
