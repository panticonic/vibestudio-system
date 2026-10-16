import { vi } from "vitest";
import type { RpcEnvelope } from "@vibestudio/rpc";
import type { WorkspaceConnectionState } from "@vibestudio/shared/workspaceConnection";
import type {
  ClientIntentEvent,
  ClientUpdateOffer,
  HostBridge,
  MenuModel,
} from "./hostBridge";

/** A fake desktop host: the bridges a client window is given, with handles to drive them. */
export function fakeHost(initial: Partial<WorkspaceConnectionState> = {}) {
  const sent: RpcEnvelope[] = [];
  const messageListeners = new Set<(envelope: RpcEnvelope) => void>();
  const recoveryListeners = new Map<string, Set<(workspaceId?: string) => void | Promise<void>>>();
  const connectionListeners = new Set<(state: WorkspaceConnectionState) => void>();
  const intentListeners = new Set<(intent: ClientIntentEvent) => void>();
  const menuListeners = new Set<(actionId: string) => void>();
  let connection = { version: 1, phase: "online", mode: "local", since: 0, ...initial } as WorkspaceConnectionState;

  const updateListeners = new Set<(offer: ClientUpdateOffer | null) => void>();
  let pendingOffer: ClientUpdateOffer | null = null;
  const update = {
    pending: vi.fn(async () => pendingOffer),
    onUpdate: vi.fn((handler: (offer: ClientUpdateOffer | null) => void) => {
      updateListeners.add(handler);
      return () => {
        updateListeners.delete(handler);
      };
    }),
    restartAtSafePoint: vi.fn(async () => {}),
  };
  let stored: Record<string, unknown> = {};
  const state = {
    get: vi.fn(async () => structuredClone(stored)),
    set: vi.fn(async (value: Record<string, unknown>) => {
      stored = structuredClone(value);
    }),
  };
  const menu = {
    set: vi.fn(async (_model: MenuModel) => {}),
    onAction: vi.fn((handler: (actionId: string) => void) => {
      menuListeners.add(handler);
      return () => {
        menuListeners.delete(handler);
      };
    }),
  };
  const host: HostBridge = {
    client: {
      update,
      state,
      menu,
      intents: {
        subscribe(handler) {
          intentListeners.add(handler);
          return () => {
            intentListeners.delete(handler);
          };
        },
      },
    },
    transport: {
      identity: { workspaceId: "system-ws", runtimeId: "client:chat:web:dev-1" },
      send: vi.fn(async (envelope: RpcEnvelope) => {
        sent.push(envelope);
      }),
      onMessage(handler) {
        messageListeners.add(handler);
        return () => {
          messageListeners.delete(handler);
        };
      },
      onRecovery(kind, handler) {
        const set = recoveryListeners.get(kind) ?? new Set();
        recoveryListeners.set(kind, set);
        set.add(handler);
        return () => {
          set.delete(handler);
        };
      },
    },
    connection: {
      getCurrent: async () => connection,
      onChange(handler) {
        connectionListeners.add(handler);
        return () => {
          connectionListeners.delete(handler);
        };
      },
    },
  };
  return {
    host,
    menu,
    sent,
    update,
    state,
    setPendingOffer(offer: ClientUpdateOffer | null) {
      pendingOffer = offer;
    },
    offerUpdate(offer: ClientUpdateOffer | null) {
      for (const listener of [...updateListeners]) listener(offer);
    },
    updateSubscribers: () => updateListeners.size,
    deliver: (envelope: RpcEnvelope) => {
      for (const listener of [...messageListeners]) listener(envelope);
    },
    recover: (kind: "resubscribe" | "cold-recover", workspaceId?: string) =>
      Promise.all([...(recoveryListeners.get(kind) ?? [])].map((handler) => handler(workspaceId))),
    recoveryListenerCount: () => [...recoveryListeners.values()].reduce((n, set) => n + set.size, 0),
    setConnection(state: Partial<WorkspaceConnectionState>) {
      connection = { ...connection, ...state };
      for (const listener of [...connectionListeners]) listener(connection);
    },
    intent: (intent: ClientIntentEvent) => {
      for (const listener of [...intentListeners]) listener(intent);
    },
    chooseMenu: (actionId: string) => {
      for (const listener of [...menuListeners]) listener(actionId);
    },
    intentSubscribers: () => intentListeners.size,
  };
}
