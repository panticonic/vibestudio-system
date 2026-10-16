import type { SupervisionChange } from "@vibestudio/shared/events";
import type { ClientRuntime } from "@vibestudio/workspace-contracts/clients";
import { createSnapshotStore, type SnapshotStore } from "@workspace/snapshot-store";

/**
 * The server announces a ready build (`supervision:changed`); the host decides
 * what to do with it (docs/client-hosts-and-clients-plan.md §4.6). This core is
 * what every client's update prompt is made of: it remembers which builds are
 * ready and not yet taken, says plainly when an update was refused or rolled
 * back, and offers apply and roll back through the host's own port.
 */

/** A client build that is ready and has not been taken. */
export interface PendingClientUpdate {
  clientId: string;
  /** The client's source (its identity in the workspace). */
  source: string;
  runtime: ClientRuntime;
  /** The build that is ready; the prompt is asked once per build. */
  buildKey: string | null;
  toVersion: string | null;
  /** The version being replaced, when known. */
  fromVersion: string | null;
  canRollback: boolean;
}

export type ClientUpdateNoticeTone = "info" | "success" | "danger";

export interface ClientUpdateNotice {
  id: string;
  tone: ClientUpdateNoticeTone;
  title: string;
  message: string;
}

/** What a host does with a ready build. The core never decides how a build is taken. */
export interface ClientUpdatePort {
  /** Take the ready build (desktop swaps the window's view, mobile reloads that client's instance, ...). */
  apply(update: PendingClientUpdate): Promise<void>;
  /** Return to the previous trusted build of the client. */
  rollback(update: PendingClientUpdate): Promise<void>;
}

/** Which client updates this surface is about. */
export interface ClientUpdateScope {
  runtime: ClientRuntime;
  /** Only this source, when the surface shows one client. */
  source?: string | null;
  /** Only this client id, when the surface shows one client. */
  clientId?: string | null;
}

export interface ClientUpdateState {
  pending: readonly PendingClientUpdate[];
  notices: readonly ClientUpdateNotice[];
  /** The client an apply or rollback is in flight for. */
  busy: string | null;
}

export interface ClientUpdateModel extends SnapshotStore<ClientUpdateState> {
  /** Feed one `supervision:changed` event. Events for other clients or runtimes are ignored. */
  handleChange(change: SupervisionChange): void;
  /** Replace the pending set with what the host persisted (updates survive a restart). */
  seed(updates: readonly PendingClientUpdate[]): void;
  apply(clientId: string): Promise<void>;
  rollback(clientId: string): Promise<void>;
  /** The person postponed it; it returns with the next build. */
  postpone(clientId: string): void;
  dismissNotice(id: string): void;
}

function normalizeSource(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

/** Whether a supervision change is about a client this surface is scoped to. */
export function isScopedClientChange(change: SupervisionChange, scope: ClientUpdateScope): boolean {
  if (change.identity.kind !== "client" || change.client?.runtime !== scope.runtime) return false;
  if (scope.source && normalizeSource(change.source) !== normalizeSource(scope.source)) return false;
  if (scope.clientId && change.identity.entityId !== scope.clientId) return false;
  return true;
}

/** The ready build a change announces, or `null` when it is not a build to take. */
export function pendingUpdateFromChange(change: SupervisionChange): PendingClientUpdate | null {
  if (change.change !== "adopted" || !change.client) return null;
  // A lifecycle event re-emitted on reconnect for the build already running is no update.
  const buildKey = change.artifact.buildKey;
  if (buildKey && change.previousBuildKey && buildKey === change.previousBuildKey) return null;
  return {
    clientId: change.identity.entityId,
    source: change.source,
    runtime: change.client.runtime,
    buildKey,
    toVersion: change.artifact.effectiveVersion?.trim() || null,
    fromVersion: change.previousEffectiveVersion?.trim() || null,
    canRollback: change.canRollback,
  };
}

/**
 * A version-aware message, so the prompt is not blind about what it is
 * installing; generic copy when the server did not report versions.
 */
export function clientUpdateMessage(update: PendingClientUpdate): string {
  const { clientId, toVersion, fromVersion } = update;
  if (toVersion && fromVersion && toVersion !== fromVersion) {
    return `${clientId} v${fromVersion} → v${toVersion} is ready to install.`;
  }
  if (toVersion) return `${clientId} v${toVersion} is ready to install.`;
  return `${clientId} has a new trusted build ready to install.`;
}

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createClientUpdateModel(input: {
  scope: ClientUpdateScope;
  port: ClientUpdatePort;
}): ClientUpdateModel {
  const { scope, port } = input;
  const store = createSnapshotStore<ClientUpdateState>({ pending: [], notices: [], busy: null });
  // A build is offered once: a person who said "later" is not asked again for it.
  const offered = new Set<string>();
  let noticeSeq = 0;
  const notify = (notice: Omit<ClientUpdateNotice, "id">) =>
    store.update((state) => ({
      ...state,
      notices: [...state.notices, { ...notice, id: `notice-${++noticeSeq}` }],
    }));
  const withoutPending = (state: ClientUpdateState, clientId: string): ClientUpdateState => ({
    ...state,
    pending: state.pending.filter((update) => update.clientId !== clientId),
  });
  const find = (clientId: string): PendingClientUpdate => {
    const update = store.getSnapshot().pending.find((candidate) => candidate.clientId === clientId);
    if (!update) throw new Error(`${clientId} has no pending update.`);
    return update;
  };
  const run = async (
    clientId: string,
    operation: (update: PendingClientUpdate) => Promise<void>,
    failureTitle: string
  ): Promise<void> => {
    const update = find(clientId);
    store.update((state) => ({ ...state, busy: clientId }));
    try {
      await operation(update);
      store.update((state) => ({ ...withoutPending(state, clientId), busy: null }));
    } catch (error) {
      store.update((state) => ({ ...state, busy: null }));
      notify({ tone: "danger", title: failureTitle, message: failureMessage(error) });
      throw error;
    }
  };
  return {
    getSnapshot: store.getSnapshot,
    subscribe: store.subscribe,
    handleChange(change) {
      if (!isScopedClientChange(change, scope)) return;
      const clientId = change.identity.entityId;
      if (change.change === "adopted") {
        const update = pendingUpdateFromChange(change);
        if (!update) return;
        const key = `${clientId}:${update.buildKey ?? "unknown"}`;
        if (offered.has(key)) return;
        offered.add(key);
        store.update((state) => ({
          ...state,
          pending: [...state.pending.filter((existing) => existing.clientId !== clientId), update],
        }));
      } else if (change.change === "update-rejected") {
        notify({
          tone: "danger",
          title: "Update not adopted",
          message: `${change.lastError ?? "The new version could not be installed."} The previous version keeps running.`,
        });
      } else if (change.change === "rolled-back") {
        store.update((state) => withoutPending(state, clientId));
        notify({
          tone: "success",
          title: "Client rolled back",
          message: `${clientId} is using the previous trusted build.`,
        });
      }
    },
    seed(updates) {
      store.update((state) => ({ ...state, pending: [...updates] }));
    },
    apply: (clientId) => run(clientId, (update) => port.apply(update), "Update failed"),
    rollback: (clientId) => run(clientId, (update) => port.rollback(update), "Rollback failed"),
    postpone(clientId) {
      store.update((state) => withoutPending(state, clientId));
    },
    dismissNotice(id) {
      store.update((state) => ({
        ...state,
        notices: state.notices.filter((notice) => notice.id !== id),
      }));
    },
  };
}
