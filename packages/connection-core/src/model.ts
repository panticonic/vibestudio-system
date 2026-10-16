import type { WorkspaceConnectionState } from "@vibestudio/shared/workspaceConnection";
import { createSnapshotStore, type SnapshotStore } from "@workspace/snapshot-store";
import { connectionNotice, type ConnectionNotice } from "./status.js";

/** What a host offers about the availability of the selected workspace server. */
export interface ConnectionPort {
  current(): Promise<WorkspaceConnectionState>;
  onChange(handler: (state: WorkspaceConnectionState) => void): () => void;
  /** Retry now (the transport is reconnecting by itself; this skips the wait). */
  reconnectNow(): Promise<void>;
  /** Start the session over; the only recovery once the session has ended. */
  relaunch(): Promise<void>;
}

export interface ConnectionModelState {
  state: WorkspaceConnectionState | null;
  notice: ConnectionNotice | null;
  /** A recovery is in flight. */
  recovering: boolean;
  /** The last recovery's failure, in the person's words; cleared by the next attempt. */
  recoveryError: unknown;
}

export interface ConnectionModel extends SnapshotStore<ConnectionModelState> {
  /** Watch the host. Returns the retirement function. */
  start(): () => void;
  /** Retry now, or relaunch when the session has ended. */
  recover(): Promise<void>;
}

/**
 * Availability as one observable value: the host's state, the notice derived
 * from it, and the one recovery action the notice offers.
 */
export function createConnectionModel(port: ConnectionPort): ConnectionModel {
  const store = createSnapshotStore<ConnectionModelState>({
    state: null,
    notice: null,
    recovering: false,
    recoveryError: undefined,
  });
  const apply = (state: WorkspaceConnectionState) =>
    store.update((current) => ({ ...current, state, notice: connectionNotice(state) }));
  return {
    getSnapshot: store.getSnapshot,
    subscribe: store.subscribe,
    start() {
      let active = true;
      // A change that lands while the first read is in flight is newer than it.
      let sawChange = false;
      const stop = port.onChange((state) => {
        if (!active) return;
        sawChange = true;
        apply(state);
      });
      void port.current().then(
        (state) => {
          if (active && !sawChange) apply(state);
        },
        (error: unknown) => {
          if (active) store.update((current) => ({ ...current, recoveryError: error }));
        }
      );
      return () => {
        active = false;
        stop();
      };
    },
    async recover() {
      const snapshot = store.getSnapshot();
      store.set({ ...snapshot, recovering: true, recoveryError: undefined });
      try {
        if (snapshot.notice?.final) await port.relaunch();
        else await port.reconnectNow();
        store.update((current) => ({ ...current, recovering: false }));
      } catch (error) {
        store.update((current) => ({ ...current, recovering: false, recoveryError: error }));
        throw error;
      }
    },
  };
}
