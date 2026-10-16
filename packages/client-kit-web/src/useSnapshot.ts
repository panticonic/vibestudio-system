import { useSyncExternalStore } from "react";
import type { SnapshotStore } from "@workspace/snapshot-store";

/** Read a headless core's snapshot store (`createApprovalQueue`, `createConnectionModel`, ...). */
export function useSnapshot<T>(store: SnapshotStore<T>): T {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
