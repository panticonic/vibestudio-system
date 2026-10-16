import {
  bridgeStreamSurfaceOf,
  createRpcClient,
  openBridgeStream,
  openBridgeUploadStream,
  RpcBoundaryError,
  rpcDestinationMatchesCaller,
  type EnvelopeRpcTransport,
  type RpcClient,
  type RpcConnectionStatus,
  type RpcDestination,
  type RpcEnvelope,
} from "@vibestudio/rpc";
import { SESSION_CONNECTION_LOST_CODE } from "@vibestudio/rpc/protocol/remoteSession";
import {
  createNativeConnectionState,
  type NativeWorkspaceConnectionBridge,
} from "./nativeConnectionState";

/** `window.__vibestudioTransport`: this client principal's envelope pipe to the routed sessions. */
export interface OwnerTransport {
  identity: { workspaceId: string; runtimeId: string };
  send(envelope: RpcEnvelope): Promise<void>;
  onMessage(handler: (envelope: RpcEnvelope) => void): () => void;
  onRecovery?(
    kind: "resubscribe" | "cold-recover",
    handler: (workspaceId?: string) => void | Promise<void>
  ): () => void;
}

/** What an owner needs from the desktop host: its transport and its single connection fact. */
export interface OwnerRpcHost {
  transport: OwnerTransport;
  connection: NativeWorkspaceConnectionBridge;
}

/**
 * Work that must follow the RPC core's own recovery handling, in order (the
 * browser's recovery coordinator resyncs workspace-owned state after it).
 */
export interface OwnerRecovery {
  run(kind: "resubscribe" | "cold-recover"): void | Promise<void>;
}

/**
 * One window's RPC to one destination. The host routes an envelope by its
 * destination to this device's session in that workspace (or the hub).
 * Closing an owner settles its listeners and fails later calls, so a retired
 * conversation or workspace cannot keep talking.
 */
export interface OwnerRpc {
  readonly rpc: RpcClient;
  close(): void;
}

function connectionLost(message: string): RpcBoundaryError {
  return new RpcBoundaryError(message, "transport", SESSION_CONNECTION_LOST_CODE);
}

export type OwnerRpcs = ReturnType<typeof createOwnerRpcs>;

/**
 * Open owners over one host bridge. Availability is the host's single
 * connection fact, observed once for every owner; a window never invents its
 * own. Closing the set closes every owner it handed out.
 */
export function createOwnerRpcs(host: OwnerRpcHost) {
  const connection = createNativeConnectionState(host.connection);
  // A refused first read surfaces on the first call through `ready()`.
  void connection.ready().catch(() => undefined);
  const owners = new Set<OwnerRpc>();
  let closed = false;
  const { transport } = host;
  const streamSurface = bridgeStreamSurfaceOf(transport);

  return {
    /** The RPC of this device's session at `destination`. */
    open(destination: RpcDestination, options: { recovery?: OwnerRecovery } = {}): OwnerRpc {
      // A window that went away while a session was still opening must not leave one behind.
      if (closed) throw connectionLost("The window's RPC is closed");
      let retired = false;
      const lifetime = new AbortController();
      const releases = new Set<() => void>();
      const statuses = new Set<(status: RpcConnectionStatus) => void>();
      const guard = (): void => {
        if (retired) throw connectionLost("This RPC session is closed");
      };
      const scoped = <T extends { destination?: RpcDestination }>(envelope: T): T => ({
        ...envelope,
        destination,
      });
      const rpcTransport: EnvelopeRpcTransport = {
        send: async (envelope) => {
          guard();
          await transport.send(scoped(envelope));
        },
        onMessage(handler) {
          const release = transport.onMessage((envelope) => {
            if (rpcDestinationMatchesCaller(destination, envelope.delivery.caller)) handler(envelope);
          });
          releases.add(release);
          return () => {
            releases.delete(release);
            release();
          };
        },
        status: () => (retired ? "disconnected" : connection.status()),
        ready: async () => {
          guard();
          await connection.ready();
        },
        onStatusChange(handler) {
          statuses.add(handler);
          const release = connection.onStatusChange((status) => {
            if (!retired) handler(status);
          });
          releases.add(release);
          return () => {
            statuses.delete(handler);
            releases.delete(release);
            release();
          };
        },
        ...(streamSurface
          ? {
              stream: (envelope, signal, body) => {
                guard();
                return openBridgeStream(streamSurface, scoped(envelope), signal ?? null, body ?? null);
              },
              streamBody: (envelope, signal, body) => {
                guard();
                if (!body) return Promise.reject(new Error("An upload requires a body"));
                return openBridgeUploadStream(streamSurface, scoped(envelope), signal ?? null, body);
              },
            }
          : {}),
      };
      const rpc = createRpcClient({
        selfId: transport.identity.runtimeId,
        callerKind: "client",
        workspaceId: transport.identity.workspaceId,
        authorityAcquisition: "wait",
        lifetime: lifetime.signal,
        onRecovery: (handler) => {
          const onRecovery = transport.onRecovery;
          if (!onRecovery) return () => undefined;
          const stops = (["resubscribe", "cold-recover"] as const).map((kind) =>
            onRecovery.call(transport, kind, (workspaceId) => {
              if (retired || destination.kind !== "workspace" || destination.workspaceId !== workspaceId)
                return;
              // The RPC core settles its own recovery policy and publishes to client
              // observers first; the owner's own recovery work follows in order.
              handler(kind);
              return options.recovery?.run(kind);
            })
          );
          for (const stop of stops) releases.add(stop);
          return () => {
            for (const stop of stops) {
              releases.delete(stop);
              stop();
            }
          };
        },
        transport: rpcTransport,
      });
      const owner: OwnerRpc = {
        rpc,
        close() {
          if (retired) return;
          retired = true;
          owners.delete(owner);
          // Retires the endpoint: its listeners are released and calls still in flight settle.
          lifetime.abort(connectionLost("This RPC session is closed"));
          for (const listener of [...statuses]) listener("disconnected");
          statuses.clear();
          for (const release of [...releases]) release();
          releases.clear();
        },
      };
      owners.add(owner);
      return owner;
    },
    close() {
      if (closed) return;
      closed = true;
      for (const owner of [...owners]) owner.close();
      connection.close();
    },
  };
}
