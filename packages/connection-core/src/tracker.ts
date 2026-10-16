import type { WorkspaceTransportStatus } from "@vibestudio/shared/workspaceConnection";
import { createSnapshotStore, type SnapshotStore } from "@workspace/snapshot-store";
import { viewFromTransport, type ConnectionView } from "./status.js";

/**
 * The reconnect state machine for a runtime whose transport only reports
 * `connecting | connected | disconnected` (mobile): remembers whether the
 * connection has ever been up, counts reconnect attempts, and folds the
 * device's reachability in.
 */
export interface ConnectionTracker extends SnapshotStore<ConnectionView> {
  transport(status: WorkspaceTransportStatus): void;
  reconnectProgress(progress: { attempt: number; nextRetryInMs?: number }): void;
  networkReachable(reachable: boolean): void;
  failure(reason: string | undefined): void;
}

export function createConnectionTracker(): ConnectionTracker {
  let status: WorkspaceTransportStatus = "connecting";
  let everOnline = false;
  let reachable = true;
  let attempt: number | undefined;
  let nextRetryInMs: number | undefined;
  let reason: string | undefined;
  const store = createSnapshotStore<ConnectionView>(
    viewFromTransport({ status, everOnline, networkReachable: reachable })
  );
  const publish = () => {
    const view = viewFromTransport({
      status,
      everOnline,
      networkReachable: reachable,
      ...(attempt === undefined ? {} : { attempt }),
      ...(reason === undefined ? {} : { reason }),
    });
    store.set(nextRetryInMs === undefined ? view : { ...view, nextRetryInMs });
  };
  return {
    getSnapshot: store.getSnapshot,
    subscribe: store.subscribe,
    transport(next) {
      status = next;
      if (next === "connected") {
        everOnline = true;
        attempt = undefined;
        nextRetryInMs = undefined;
        reason = undefined;
      }
      publish();
    },
    reconnectProgress(progress) {
      attempt = progress.attempt;
      nextRetryInMs = progress.nextRetryInMs;
      publish();
    },
    networkReachable(next) {
      reachable = next;
      publish();
    },
    failure(next) {
      reason = next;
      publish();
    },
  };
}
