import { createTypedRpcServiceClient } from "@vibestudio/shared/typedRpcServiceClient";
/**
 * Mobile RPC client for React Native.
 *
 * The connection is the host's: the device credential, the physical Iroh
 * connection and its reconnection live in the host runtime, and a workspace
 * session is a `RemoteConnection` the client's account opened through it. This
 * class adapts one such connection (and its hub control pipe) to the
 * `RpcClient` surface the shell code consumes.
 */

import {
  isRpcConnectionLost,
  type RpcCallOptions,
  type RpcClient,
  type RpcContextHandler,
  type RpcConnectionStatus,
  type RpcEventContext,
  type RpcStreamOptions,
} from "@vibestudio/rpc";
import type { RecoveryKind } from "@vibestudio/rpc/protocol/recoveryCoordinator";
import type { RemoteConnection, RemoteSession } from "@vibestudio/rn-client-api";
import type { PanelEntityId } from "@vibestudio/shared/panel/ids";
import { authMethods } from "@vibestudio/service-schemas/auth";

/** Several independent failures of one operation, kept together so none is lost. */
export class MobileConnectionAggregateError extends Error {
  readonly errors: readonly unknown[];
  override readonly cause: unknown;

  constructor(errors: readonly unknown[], message: string) {
    super(`${message}: ${errors.map(errorMessage).join("; ")}`);
    this.name = "MobileConnectionAggregateError";
    this.errors = errors;
    this.cause = errors[0];
  }
}

/**
 * The System owner withdrew this client's device-level trust. The host tears the
 * instance down; nothing in the client reopens a session after it.
 */
export class ClientTrustRevokedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClientTrustRevokedError";
  }
}

export interface ReconnectProgress {
  attempt: number;
  phase: "scheduled" | "connecting" | "failed";
  reason: string;
  nextRetryInMs?: number;
}

function smokePhase(phase: string, details?: Record<string, unknown>): void {
  const suffix = details ? ` ${JSON.stringify(details)}` : "";
  console.log(`[VibestudioMobileSmoke] phase=${phase}${suffix}`);
}

function optionsForSelectedPipe<T extends RpcCallOptions | RpcStreamOptions>(
  options: T | undefined,
  hub: boolean,
): T | undefined {
  if (!hub || !options) return options;
  const { destination: _destination, ...rest } = options;
  return (Object.keys(rest).length ? rest : undefined) as T | undefined;
}

export type ConnectionStatus = RpcConnectionStatus;

/** Whether an idempotent shell operation should be retried on the same pipe. */
export function isTransientMobileTransportFailure(error: unknown): boolean {
  let current = error;
  const seen = new Set<unknown>();
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const candidate = current as {
      code?: unknown;
      cause?: unknown;
      errorKind?: unknown;
    };
    if (
      candidate.errorKind !== undefined &&
      candidate.errorKind !== "transport"
    )
      return false;
    if (
      isRpcConnectionLost(current) ||
      candidate.code === "IROH_RESPONSE_HEAD_TIMEOUT"
    ) {
      return true;
    }
    current = candidate.cause;
  }
  return false;
}

export interface MobileRpcClientConfig {
  /** Immutable workspace session factory supplied by the retained account. */
  connectWorkspace: (
    onRecovery: (kind: RecoveryKind) => void | Promise<void>,
  ) => Promise<RemoteConnection>;
}

export function createMobileRpcClient(
  config: MobileRpcClientConfig,
): MobileRpcClient {
  return new MobileRpcClient(config);
}

export class MobileRpcClient implements Pick<
  RpcClient,
  | "selfId"
  | "expose"
  | "call"
  | "emit"
  | "on"
  | "stream"
  | "streamReadable"
  | "onRecovery"
> {
  private readonly config: MobileRpcClientConfig;
  private connection: RemoteConnection | null = null;
  private rpc: RpcClient | null = null;
  private controlRpc: RpcClient | null = null;
  // Dedupes concurrent connect attempts: the Iroh handshake is eager + async,
  // so a stray call() racing connectAndWait() must not open a second pipe.
  private connecting: Promise<RpcClient> | null = null;
  private retirement: Promise<void> | null = null;
  // One lifetime covers connection establishment and the adopted session.
  // Teardown retires it before async close, so late callbacks cannot affect a
  // replacement session and a late handshake closes its own unused connection.
  private connectionToken: object | null = null;
  private connectionSubscriptions: Array<() => void> = [];
  private currentCallerId: string | null = null;
  // Set when the host reported this client's trust withdrawn: terminal, so no
  // later call or reconnect opens another session.
  private trustRevoked: ClientTrustRevokedError | null = null;
  private authenticatedServerId: string | null = null;
  private statusState: ConnectionStatus = "disconnected";
  private readonly statusListeners = new Set<
    (status: ConnectionStatus) => void
  >();
  private readonly reconnectProgressListeners = new Set<
    (progress: ReconnectProgress) => void
  >();
  private readonly recoveryListeners = new Set<(kind: RecoveryKind) => void>();
  private readonly eventSubscriptions = new Map<
    string,
    Set<(event: RpcEventContext) => void>
  >();
  private readonly activeEventUnsubs = new Map<string, () => void>();
  private readonly exposedHandlers = new Map<
    string,
    RpcContextHandler<any, any>
  >();

  constructor(config: MobileRpcClientConfig) {
    this.config = config;
  }

  get selfId(): string {
    return this.currentCallerId ?? "shell:pending";
  }

  get serverId(): string | null {
    return this.authenticatedServerId;
  }

  get status(): ConnectionStatus {
    return this.connection?.session.status() ?? this.statusState;
  }

  connect(): void {
    // The shared connection job reports its terminal failure once.
    void this.ensureRpc().catch(() => undefined);
  }

  async connectAndWait(): Promise<void> {
    const token = this.ensureConnectionLifetime();
    try {
      await this.ensureRpc();
      this.assertConnectionLifetime(token);
    } catch (error) {
      this.assertConnectionLifetime(token);
      if (error instanceof ConnectSupersededError) throw error;
      throw error;
    }
  }

  reconnect(): void {
    const closing = this.teardown();
    const token = this.ensureConnectionLifetime();
    this.startConnectionJob(token, closing);
  }

  onReconnectProgress(
    listener: (progress: ReconnectProgress) => void,
  ): () => void {
    this.reconnectProgressListeners.add(listener);
    return () => this.reconnectProgressListeners.delete(listener);
  }

  async waitUntilConnected(timeoutMs: number): Promise<void> {
    if (this.status === "connected") return;
    await new Promise<void>((resolve, reject) => {
      let timeout: ReturnType<typeof setTimeout> | null = null;
      const remove = this.onStatusChange((status) => {
        if (status !== "connected") return;
        if (timeout) clearTimeout(timeout);
        remove();
        resolve();
      });
      timeout = setTimeout(
        () => {
          remove();
          reject(
            new Error(
              "The secure workspace connection did not recover in time",
            ),
          );
        },
        Math.max(1, timeoutMs),
      );
    });
  }

  private emitReconnectProgress(progress: ReconnectProgress): void {
    for (const listener of this.reconnectProgressListeners) listener(progress);
  }

  disconnect(): void {
    if (!this.connectionToken && !this.connection && !this.connecting) {
      this.setStatus("disconnected");
      return;
    }
    void this.close().catch((error) =>
      this.reportTransportFailure("Disconnect teardown failed", error),
    );
  }

  /** Deterministic ownership handoff used before the native RN runtime reloads. */
  async close(): Promise<void> {
    await this.teardown();
  }

  onStatusChange(callback: (status: ConnectionStatus) => void): () => void {
    this.statusListeners.add(callback);
    return () => {
      this.statusListeners.delete(callback);
    };
  }

  async call<Args extends unknown[], Result>(
    targetId: string,
    method: import("@vibestudio/rpc").RpcMethod<Args, Result>,
    args: NoInfer<Args>,
    options?: RpcCallOptions,
  ): Promise<Result> {
    const workspaceRpc = await this.ensureRpc();
    const hub = options?.destination?.kind === "hub";
    const selected = hub ? this.controlRpc : workspaceRpc;
    if (!selected)
      throw new Error("Stable hub control connection not established");
    const selectedOptions = optionsForSelectedPipe(options, hub);
    return selected.call(targetId, method, args, selectedOptions);
  }

  expose<TArgs extends unknown[], TReturn>(
    method: string,
    handler: RpcContextHandler<TArgs, TReturn>,
  ): void {
    if (this.exposedHandlers.has(method)) {
      throw new Error(`Mobile RPC method "${method}" is already exposed`);
    }
    this.exposedHandlers.set(method, handler);
    // The workspace host dispatcher owns these presentation calls.
    // The account control server does not relay calls to workspace runtimes.
    this.rpc?.expose(method, handler, {
      kind: "closed",
      reason:
        "Mobile presentation host methods are entered through the host dispatcher.",
    });
  }

  async stream<Args extends unknown[], Result>(
    targetId: string,
    method: import("@vibestudio/rpc").RpcMethod<Args, Result>,
    args: NoInfer<Args>,
    options?: RpcStreamOptions,
  ): Promise<Response> {
    const workspaceRpc = await this.ensureRpc();
    const hub = options?.destination?.kind === "hub";
    const selected = hub ? this.controlRpc : workspaceRpc;
    if (!selected)
      throw new Error("Stable hub control connection not established");
    return selected.stream(
      targetId,
      method,
      args,
      optionsForSelectedPipe(options, hub),
    );
  }

  /**
   * Like {@link stream} but yields the decoded head + a raw `ReadableStream`
   * body — RN's whatwg-fetch `Response` cannot consume a ReadableStream. The
   * panel-asset façade (B2) reads panel bundles through this. `options.body`
   * streams a request body on the same request-owned QUIC stream.
   */
  async streamReadable<Args extends unknown[], Result>(
    targetId: string,
    method: import("@vibestudio/rpc").RpcMethod<Args, Result>,
    args: NoInfer<Args>,
    options?: RpcStreamOptions,
  ): ReturnType<RpcClient["streamReadable"]> {
    const workspaceRpc = await this.ensureRpc();
    const hub = options?.destination?.kind === "hub";
    const selected = hub ? this.controlRpc : workspaceRpc;
    if (!selected)
      throw new Error("Stable hub control connection not established");
    return selected.streamReadable(
      targetId,
      method,
      args,
      optionsForSelectedPipe(options, hub),
    );
  }

  /**
   * Open a dedicated per-panel "panel" session over the existing connection.
   * The server attributes calls by the authenticated SESSION principal, so a
   * panel needs its OWN grant-redeemed "panel" session — relaying over the shell
   * session makes its calls show up as "shell", which capability-gated services
   * (e.g. PubSub `subscribe`, allowed: panel/do) reject. The host opens it as a
   * logical session on the same physical connection (a second session, not a
   * second connection). The grant is one-shot, so `getToken` refetches a fresh
   * one on every (re)authentication; the grant principal becomes this session's
   * callerId, which equals the panel bundle's RPC `from` (cfg.entityId) so routed
   * responses match their recorded origin.
   */
  async openPanelSession(
    runtimeEntityId: PanelEntityId,
    connectionId: string,
  ): Promise<RemoteSession> {
    const rpc = await this.ensureRpc();
    const connection = this.connection;
    if (!connection) throw new Error("Workspace connection not established");
    const authClient = createTypedRpcServiceClient(rpc, { targetId: "main", namespace: "auth" }, authMethods);
    const session = connection.transport.openSession({
      label: `panel ${runtimeEntityId}`,
      connectionId,
      getToken: async () => {
        const grant = await authClient.grantConnection(runtimeEntityId);
        return grant.token;
      },
    });
    await session.ready();
    return session;
  }

  async emit(targetId: string, event: string, payload: unknown): Promise<void> {
    return (await this.ensureRpc()).emit(targetId, event, payload);
  }

  on(event: string, listener: (event: RpcEventContext) => void): () => void {
    let listeners = this.eventSubscriptions.get(event);
    if (!listeners) {
      listeners = new Set();
      this.eventSubscriptions.set(event, listeners);
    }
    listeners.add(listener);
    this.attachEventSubscription(event);
    return () => {
      listeners?.delete(listener);
      if (listeners?.size === 0) {
        this.eventSubscriptions.delete(event);
        this.activeEventUnsubs.get(event)?.();
        this.activeEventUnsubs.delete(event);
      }
    };
  }

  onRecovery(listener: (kind: RecoveryKind) => void): () => void {
    this.recoveryListeners.add(listener);
    return () => this.recoveryListeners.delete(listener);
  }

  private ensureConnectionLifetime(): object {
    return (this.connectionToken ??= {});
  }

  private assertConnectionLifetime(token: object): void {
    if (this.connectionToken !== token) throw new ConnectSupersededError();
  }

  private async ensureRpc(): Promise<RpcClient> {
    if (this.trustRevoked) throw this.trustRevoked;
    if (this.rpc) return this.rpc;
    if (this.connecting) return this.connecting;
    return this.startConnectionJob(this.ensureConnectionLifetime());
  }

  private startConnectionJob(
    token: object,
    retirement = this.retirement,
  ): Promise<RpcClient> {
    // This one promise includes preceding retirement and the opening of the
    // session; the host owns every later reconnection. A failed job remains
    // terminal until an explicit new connection intent.
    const connecting = (async () => {
      await retirement;
      this.assertConnectionLifetime(token);
      if (this.trustRevoked) throw this.trustRevoked;
      this.setStatus("connecting");
      this.emitReconnectProgress({
        attempt: 1,
        phase: "connecting",
        reason: "opening the workspace session",
      });
      try {
        return await this.establishConnection(token);
      } catch (error) {
        if (!(error instanceof ConnectSupersededError)) {
          this.emitReconnectProgress({
            attempt: 1,
            phase: "failed",
            reason: errorMessage(error),
          });
        }
        throw error;
      }
    })();
    this.connecting = connecting;
    void connecting.catch((error) => {
      if (this.connectionToken !== token) return;
      this.reportTransportFailure("Connection failed", error, token);
    });
    return connecting;
  }

  private async establishConnection(token: object): Promise<RpcClient> {
    let connection: RemoteConnection | undefined;
    const current = () =>
      this.connectionToken === token &&
      connection !== undefined &&
      this.connection === connection;
    const recover = (kind: RecoveryKind): void => {
      if (current()) this.emitRecovery(kind);
    };
    try {
      connection = await this.config.connectWorkspace(recover);
    } catch (error) {
      this.assertConnectionLifetime(token);
      throw error;
    }
    if (this.connectionToken !== token) {
      return this.retireAttemptAndThrow(
        connection,
        new ConnectSupersededError(),
      );
    }
    const subscriptions: Array<() => void> = [];
    const events = new Map<string, () => void>();
    try {
      if (
        connection.serverId &&
        this.authenticatedServerId &&
        connection.serverId !== this.authenticatedServerId
      ) {
        throw new Error(
          "The workspace route changed the authenticated account server",
        );
      }
      if (!connection.hubControlRpc)
        throw new Error(
          "Mobile session did not retain its stable hub control pipe",
        );
      const rpc = connection.rpc;
      for (const [method, handler] of this.exposedHandlers)
        rpc.expose(method, handler, {
          kind: "closed",
          reason:
            "This handler controls an internal execution or presentation surface.",
        });
      subscriptions.push(
        connection.session.onStatusChange((status) => {
          if (current()) this.setStatus(status);
        }),
      );
      subscriptions.push(
        connection.transport.onReconnectProgress((progress) => {
          if (current()) this.emitReconnectProgress(progress);
        }),
        connection.session.onClosed((closed) => {
          if (current() && closed.reason === "trust-revoked")
            this.handleTrustRevoked(closed.message);
        }),
      );
      for (const event of this.eventSubscriptions.keys())
        events.set(event, this.subscribeToRpcEvent(rpc, event));
      this.assertConnectionLifetime(token);
    } catch (error) {
      return this.retireAttemptAndThrow(connection, error, [
        ...subscriptions,
        ...events.values(),
      ]);
    }
    this.authenticatedServerId ??= connection.serverId ?? null;
    this.connection = connection;
    this.currentCallerId = connection.callerId;
    this.rpc = connection.rpc;
    this.controlRpc = connection.hubControlRpc;
    this.connectionSubscriptions = subscriptions;
    for (const [event, stop] of events) this.activeEventUnsubs.set(event, stop);
    this.setStatus(connection.session.status());
    smokePhase("workspace-iroh-connected", { callerId: connection.callerId });
    return this.rpc;
  }

  private async teardown(): Promise<void> {
    this.connectionToken = null;
    this.connecting = null;
    const closing = this.closeConnectionResources();
    this.setStatus("disconnected");
    await closing;
  }

  /** Detach the exact adopted connection before asynchronous native cleanup. */
  private async closeConnectionResources(): Promise<void> {
    const connection = this.connection;
    this.connection = null;
    this.rpc = null;
    this.controlRpc = null;
    this.currentCallerId = null;
    const subscriptions = [
      ...this.connectionSubscriptions.splice(0),
      ...this.activeEventUnsubs.values(),
    ];
    this.activeEventUnsubs.clear();
    await this.retireResources(connection, subscriptions);
  }

  private retireResources(
    connection: RemoteConnection | null,
    subscriptions: Array<() => void>,
  ): Promise<void> {
    if (!connection && subscriptions.length === 0)
      return this.retirement ?? Promise.resolve();
    const cleanup = closeConnectionResources(connection, subscriptions);
    const previous = this.retirement;
    const retirement = previous
      ? Promise.allSettled([previous, cleanup]).then((results) => {
          const failures = results.flatMap((result) =>
            result.status === "rejected" ? [result.reason] : [],
          );
          if (failures.length)
            throw new MobileConnectionAggregateError(
              failures,
              "Mobile connection resources could not all be closed",
            );
        })
      : cleanup;
    this.retirement = retirement;
    void retirement.then(
      () => {
        if (this.retirement === retirement) this.retirement = null;
      },
      () => undefined,
    );
    return retirement;
  }

  private async retireAttemptAndThrow(
    connection: RemoteConnection,
    error: unknown,
    subscriptions: Array<() => void> = [],
  ): Promise<never> {
    try {
      await this.retireResources(connection, subscriptions);
    } catch (cleanupError) {
      throw new MobileConnectionAggregateError(
        [error, cleanupError],
        "Mobile connection setup failed and its resources could not all be closed",
      );
    }
    throw error;
  }

  private reportTransportFailure(
    context: string,
    error: unknown,
    token: object | null = null,
  ): void {
    const reason = `${context}: ${errorMessage(error)}`;
    console.error(`[MobileRpcClient] ${reason}`, error);
    if (this.connectionToken === token) {
      this.emitReconnectProgress({ attempt: 0, phase: "failed", reason });
      this.setStatus("disconnected");
    }
  }

  private attachEventSubscription(event: string): void {
    if (!this.rpc || this.activeEventUnsubs.has(event)) return;
    this.activeEventUnsubs.set(
      event,
      this.subscribeToRpcEvent(this.rpc, event),
    );
  }

  private subscribeToRpcEvent(rpc: RpcClient, event: string): () => void {
    return rpc.on(
      event,
      (ev) => {
        if (this.rpc !== rpc) return;
        for (const listener of this.eventSubscriptions.get(event) ?? [])
          listener(ev);
      },
      {
        kind: "closed",
        reason:
          "This listener consumes host or implementation lifecycle events.",
      },
    );
  }

  private setStatus(status: ConnectionStatus): void {
    this.statusState = status;
    for (const listener of this.statusListeners) listener(status);
  }

  /** The host withdrew this client's trust: end the connection and never reopen it. */
  private handleTrustRevoked(message: string): void {
    this.trustRevoked ??= new ClientTrustRevokedError(message);
    this.connectionToken = null;
    this.connecting = null;
    this.setStatus("disconnected");
    void this.closeConnectionResources().catch((error) =>
      this.reportTransportFailure("Trust-revoked teardown failed", error),
    );
  }

  /**
   * Fire the recovery listeners for `kind`. Driven by the Iroh session's
   * post-auth recovery signal: "resubscribe" on
   * a normal reconnect, "cold-recover" when the server restarted (serverBootId
   * changed) / the session was dirty — so ShellClient's cold-recover listener
   * actually fires instead of only ever running the lighter resubscribe.
   */
  private emitRecovery(kind: RecoveryKind): void {
    for (const listener of [...this.recoveryListeners]) {
      try {
        const result = (listener as (recoveryKind: RecoveryKind) => unknown)(kind);
        if (
          result !== null &&
          (typeof result === "object" || typeof result === "function") &&
          "then" in result &&
          typeof result.then === "function"
        ) {
          void Promise.resolve(result).catch((error: unknown) => {
            console.error(
              "[MobileRpcClient] Async recovery observer failed:",
              error,
            );
          });
        }
      } catch (error) {
        console.error("[MobileRpcClient] Recovery observer failed:", error);
      }
    }
  }
}

/** Thrown by an in-flight establishConnection() that teardown() invalidated. */
class ConnectSupersededError extends Error {
  constructor() {
    super("Iroh connect superseded by disconnect/reconnect");
    this.name = "ConnectSupersededError";
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function closeConnectionResources(
  connection: RemoteConnection | null,
  subscriptions: Array<() => void>,
): Promise<void> {
  const failures: unknown[] = [];
  for (const stop of subscriptions) {
    try {
      stop();
    } catch (error) {
      failures.push(error);
    }
  }
  try {
    await connection?.close();
  } catch (error) {
    failures.push(error);
  }
  if (failures.length)
    throw new MobileConnectionAggregateError(
      failures,
      "Mobile connection resources could not all be closed",
    );
}
