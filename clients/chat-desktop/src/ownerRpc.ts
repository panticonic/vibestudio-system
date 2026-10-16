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
} from "@vibestudio/rpc";
import { SESSION_CONNECTION_LOST_CODE } from "@vibestudio/rpc/protocol/remoteSession";
import type { HostBridge } from "./hostBridge";

/**
 * The window's RPC, one client per destination. The host routes an envelope by
 * its destination to this device's session in that workspace (or the hub), so a
 * chat window reaches the Personal workspace without the System one's help.
 *
 * Availability is the host's single connection fact; a window never invents its
 * own. Closing an owner settles its listeners and fails later calls, so a
 * retired conversation cannot keep talking.
 */
export interface OwnerRpc {
  readonly rpc: RpcClient;
  close(): void;
}

function connectionLost(message: string): RpcBoundaryError {
  return new RpcBoundaryError(message, "transport", SESSION_CONNECTION_LOST_CODE);
}

/** The host's availability fact as an RPC status, settled once from `getCurrent`. */
function observeConnection(bridge: HostBridge["connection"]) {
  let status: RpcConnectionStatus = "connecting";
  let changed = false;
  const listeners = new Set<(status: RpcConnectionStatus) => void>();
  const publish = (next: RpcConnectionStatus) => {
    if (status === next) return;
    status = next;
    for (const listener of [...listeners]) listener(next);
  };
  const apply = (phase: string) =>
    publish(phase === "online" ? "connected" : phase === "ended" ? "disconnected" : "connecting");
  const stop = bridge.onChange((state) => {
    changed = true;
    apply(state.phase);
  });
  const initialized = bridge.getCurrent().then((state) => {
    if (!changed) apply(state.phase);
  });
  return {
    status: () => status,
    /** Wait only for the first authoritative fact, never for a later reconnection. */
    async ready() {
      if (!changed) await initialized;
      if (status !== "connected") throw connectionLost("Workspace connection is unavailable");
    },
    onStatusChange(handler: (status: RpcConnectionStatus) => void) {
      listeners.add(handler);
      return () => {
        listeners.delete(handler);
      };
    },
    close() {
      stop();
      listeners.clear();
    },
  };
}

export type RpcOwners = ReturnType<typeof createRpcOwners>;

/** Open owners over one host bridge. Closing it closes every owner it handed out. */
export function createRpcOwners(host: HostBridge) {
  const connection = observeConnection(host.connection);
  // A refused first read surfaces on the first call through `ready()`.
  void connection.ready().catch(() => undefined);
  const owners = new Set<OwnerRpc>();
  let closed = false;
  const { transport } = host;
  const streamSurface = bridgeStreamSurfaceOf(transport);

  return {
    /** The RPC of this device's session at `destination`. */
    open(destination: RpcDestination): OwnerRpc {
      // A window that went away while a session was still opening must not leave one behind.
      if (closed) throw connectionLost("Chat is closed");
      let retired = false;
      const lifetime = new AbortController();
      const releases = new Set<() => void>();
      const statuses = new Set<(status: RpcConnectionStatus) => void>();
      const guard = (): void => {
        if (retired) throw connectionLost("Chat session is closed");
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
              handler(kind);
            })
          );
          return () => {
            for (const stop of stops) stop();
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
          lifetime.abort(connectionLost("Chat session is closed"));
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
