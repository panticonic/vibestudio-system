import { createSnapshotStore, type SnapshotStore } from "@workspace/snapshot-store";
import type { PendingApproval } from "@vibestudio/shared/approvals";
import type { DurableObservation } from "@vibestudio/shell-core/durableObservation";
import type { ApprovalsClient } from "./client.js";

export type ApprovalQueueState =
  | { status: "loading"; pending: readonly PendingApproval[] }
  | { status: "ready"; pending: readonly PendingApproval[] }
  | { status: "failed"; pending: readonly PendingApproval[]; error: unknown };

export interface ApprovalQueue extends SnapshotStore<ApprovalQueueState> {
  /** Admit the subscription and read the first authoritative queue; resolves when it is on screen. */
  start(): Promise<void>;
  /** Read the authoritative queue again. */
  refresh(): Promise<void>;
  /** Retire the subscription and join its in-flight work; `reason` is what pending reads are rejected with. */
  stop(reason?: unknown): Promise<void>;
}

/**
 * The pending queue as one observable value. The queue is authoritative on the
 * host: this only mirrors it, so a decision made on any surface shows up on
 * every other. Failures are kept in the state (and rejected from `start`), never
 * swallowed.
 */
export function createApprovalQueue(client: Pick<ApprovalsClient, "observe">): ApprovalQueue {
  const store = createSnapshotStore<ApprovalQueueState>({ status: "loading", pending: [] });
  let observation: DurableObservation | null = null;
  const requireObservation = (): DurableObservation => {
    if (!observation) throw new Error("The approval queue has not been started");
    return observation;
  };
  return {
    getSnapshot: store.getSnapshot,
    subscribe: store.subscribe,
    async start() {
      if (observation) return requireObservation().ready;
      observation = client.observe(
        (pending) => store.set({ status: "ready", pending }),
        (error) => store.update((current) => ({ status: "failed", pending: current.pending, error }))
      );
      return observation.ready;
    },
    refresh: () => requireObservation().refresh(),
    async stop(reason?: unknown) {
      const current = observation;
      observation = null;
      await current?.stop(reason);
    },
  };
}
