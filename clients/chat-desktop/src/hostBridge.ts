import type { RpcEnvelope } from "@vibestudio/rpc";
import type { WorkspaceConnectionState } from "@vibestudio/shared/workspaceConnection";

/**
 * What this window may rely on from the desktop host (`web-host-1`), named
 * here once so the rest of the client takes it as an argument and a test can
 * hand it a fake. The host preload exposes these as globals; nothing here
 * reaches past them.
 */

export interface ClientIntentEvent {
  name: string;
  params: Record<string, string>;
}

export interface MenuModel {
  menus: Array<{ label: string; items: MenuItem[] }>;
  popup: MenuItem[];
}

export interface MenuItem {
  id?: string;
  label?: string;
  accelerator?: string;
  separator?: true;
  submenu?: MenuItem[];
}

/** A newer build of this client the host is holding for the person. */
export interface ClientUpdateOffer {
  clientId: string;
  source: string;
  buildKey: string;
  effectiveVersion: string | null;
  previousEffectiveVersion: string | null;
}

/** This client's own update, observed and taken through the host. Every client has it. */
export interface ClientUpdateBridge {
  pending(): Promise<ClientUpdateOffer | null>;
  /** The host's offer changed (a newer build was announced, or the offer was retired). */
  onUpdate(handler: (offer: ClientUpdateOffer | null) => void): () => void;
  /** Move this client's windows to the pending build. Rejects when nothing is pending. */
  restartAtSafePoint(): Promise<void>;
}

/** One bounded JSON object the host keeps for this client on this device. */
export interface ClientStateBridge {
  get(): Promise<Record<string, unknown>>;
  set(value: Record<string, unknown>): Promise<void>;
}

/** `window.__vibestudioClient`: per-window services; each is gated by a capability. */
export interface ClientBridge {
  update: ClientUpdateBridge;
  state: ClientStateBridge;
  /** `native-menus`. Absent or rejecting when the host did not grant it. */
  menu?: {
    set(model: MenuModel): Promise<void>;
    onAction(handler: (actionId: string) => void): () => void;
  };
  /** Foreground intents; the host holds those that arrived before the first subscription. */
  intents: {
    subscribe(handler: (intent: ClientIntentEvent) => void): () => void;
  };
}

/** `window.__vibestudioTransport`: this client principal's envelope pipe to the routed sessions. */
export interface ClientTransport {
  identity: { workspaceId: string; runtimeId: string };
  send(envelope: RpcEnvelope): Promise<void>;
  onMessage(handler: (envelope: RpcEnvelope) => void): () => void;
  onRecovery?(
    kind: "resubscribe" | "cold-recover",
    handler: (workspaceId?: string) => void | Promise<void>
  ): () => void;
}

/** `window.__vibestudioWorkspaceConnection`: availability of the host's server connection. */
export interface ConnectionBridge {
  getCurrent(): Promise<WorkspaceConnectionState>;
  onChange(handler: (state: WorkspaceConnectionState) => void): () => void;
}

export interface HostBridge {
  client: ClientBridge;
  transport: ClientTransport;
  connection: ConnectionBridge;
}

/** The bridges this window was given. A window the host did not prepare cannot run. */
export function readHostBridge(scope: object = globalThis): HostBridge {
  const g = scope as {
    __vibestudioClient?: ClientBridge;
    __vibestudioTransport?: ClientTransport;
    __vibestudioWorkspaceConnection?: ConnectionBridge;
  };
  if (!g.__vibestudioClient || !g.__vibestudioTransport || !g.__vibestudioWorkspaceConnection)
    throw new Error("This page is not running inside a Vibestudio desktop client window");
  return {
    client: g.__vibestudioClient,
    transport: g.__vibestudioTransport,
    connection: g.__vibestudioWorkspaceConnection,
  };
}
