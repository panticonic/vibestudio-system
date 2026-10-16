import { createReceiverRpcMethods } from "@vibestudio/shared/rpcMethods";
import { mainRpcMethods } from "@vibestudio/service-schemas/mainRpc";
import type { PanelEntityId } from "@vibestudio/shared/panel/ids";
import type {
  RpcClient,
  RpcConnectionStatus,
  RpcEventContext,
} from "@vibestudio/rpc";
import type { RecoveryKind } from "@vibestudio/rpc/protocol/recoveryCoordinator";
import type { RemoteConnection, RemoteSession } from "@vibestudio/rn-client-api";
import {
  ClientTrustRevokedError,
  isTransientMobileTransportFailure,
  MobileConnectionAggregateError,
  MobileRpcClient,
  type ReconnectProgress,
} from "./mobileTransport";

const DEVICE_ID = `dev_${"d".repeat(24)}`;

describe("isTransientMobileTransportFailure", () => {
  it("recognizes structured connection and Iroh response timeout failures", () => {
    expect(isTransientMobileTransportFailure({ code: "CONNECTION_LOST" })).toBe(
      true,
    );
    expect(
      isTransientMobileTransportFailure({
        cause: { code: "IROH_RESPONSE_HEAD_TIMEOUT" },
      }),
    ).toBe(true);
  });

  it("does not retry unrelated application failures", () => {
    expect(
      isTransientMobileTransportFailure({
        code: "CONNECTION_LOST",
        errorKind: "authorization",
      }),
    ).toBe(false);
    expect(
      isTransientMobileTransportFailure({
        errorKind: "access",
        cause: { code: "CONNECTION_LOST", errorKind: "transport" },
      }),
    ).toBe(false);
    expect(
      isTransientMobileTransportFailure({
        code: "IROH_RESPONSE_HEAD_TIMEOUT",
        errorKind: "application",
      }),
    ).toBe(false);
    expect(isTransientMobileTransportFailure(new Error("access denied"))).toBe(
      false,
    );
  });
});

// Overrides are test doubles, not RpcClients: `call` and `stream` are generic
// in their result, which no jest.fn can satisfy. Key names stay checked so a
// typo is still an error, and the result is cast once, below.
function makeRpc(
  overrides: Partial<Record<keyof RpcClient, unknown>> = {},
): RpcClient {
  return {
    selfId: `shell:${DEVICE_ID}`,
    expose: jest.fn(),
    call: jest.fn(),
    emit: jest.fn(),
    on: jest.fn(() => jest.fn()),
    stream: jest.fn(),
    streamReadable: jest.fn(),
    ...overrides,
  } as unknown as RpcClient;
}

function makeSession(overrides: Partial<RemoteSession> = {}): RemoteSession {
  return {
    callerId: jest.fn(() => `shell:${DEVICE_ID}`),
    isClosed: jest.fn(() => false),
    close: jest.fn(),
    onMessage: jest.fn(() => jest.fn()),
    send: jest.fn(),
    status: jest.fn(() => "connected" as RpcConnectionStatus),
    onStatusChange: jest.fn(() => jest.fn()),
    stream: jest.fn(),
    streamReadable: jest.fn(),
    ready: jest.fn(async () => undefined),
    onClosed: jest.fn(() => jest.fn()),
    ...overrides,
  } as unknown as RemoteSession;
}

// Overrides are doubles, so they are accepted by key name and the assembled
// connection is cast once — the same contract as makeRpc above.
function makeConnection(
  overrides: Partial<Record<keyof RemoteConnection, unknown>> = {},
): RemoteConnection {
  const session = overrides.session ?? makeSession();
  return {
    callerId: `shell:${DEVICE_ID}`,
    deviceId: DEVICE_ID,
    rpc: overrides.rpc ?? makeRpc(),
    hubControlRpc: overrides.hubControlRpc ?? makeRpc(),
    session,
    transport:
      overrides.transport ??
      ({
        openSession: jest.fn(),
        onReconnectProgress: jest.fn(() => jest.fn()),
      } as unknown as RemoteConnection["transport"]),
    close: jest.fn(async () => undefined),
    ...overrides,
  } as unknown as RemoteConnection;
}

/** A client whose account opens `connections` in order (the last one repeats). */
function clientOver(...connections: RemoteConnection[]): {
  client: MobileRpcClient;
  factory: jest.Mock;
} {
  let next = 0;
  const factory = jest.fn(
    async () => connections[Math.min(next++, connections.length - 1)]!,
  );
  return { client: new MobileRpcClient({ connectWorkspace: factory }), factory };
}

describe("MobileRpcClient host transport", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("opens the account's workspace session and delegates RPC calls", async () => {
    const call = jest.fn(
      async (
        _target: string,
        _method: { name: string },
        _args: unknown[],
        _options?: unknown,
      ) => ({ ok: true }),
    );
    const rpc = makeRpc({
      call,
    });
    const { client, factory } = clientOver(makeConnection({ rpc }));

    await client.connectAndWait();

    expect(factory).toHaveBeenCalledTimes(1);
    expect(client.selfId).toBe(`shell:${DEVICE_ID}`);
    expect(client.status).toBe("connected");
    await expect(
      client.call("main", testRpcMethods["demo.hello"], ["world"]),
    ).resolves.toEqual({
      ok: true,
    });
    expect(
      call.mock.calls.some(
        ([target, method, args, options]) =>
          target === "main" &&
          method?.name === "demo.hello" &&
          args[0] === "world" &&
          options === undefined,
      ),
    ).toBe(true);
  });

  it("exposes shell presentation handlers before connect and reattaches them after reconnect", async () => {
    const firstRpc = makeRpc();
    const secondRpc = makeRpc();
    const accountRpc = makeRpc();
    const firstConnection = makeConnection({
      rpc: firstRpc,
      hubControlRpc: accountRpc,
    });
    const secondConnection = makeConnection({
      rpc: secondRpc,
      hubControlRpc: accountRpc,
    });
    const { client } = clientOver(firstConnection, secondConnection);
    const handler = jest.fn(async () => undefined);

    client.expose("mobileBrowserPrivacyPresentation.open", handler);
    expect(firstRpc.expose).not.toHaveBeenCalled();

    await client.connectAndWait();
    expect(firstRpc.expose).toHaveBeenCalledWith(
      "mobileBrowserPrivacyPresentation.open",
      handler,
      {
        kind: "closed",
        reason:
          "This handler controls an internal execution or presentation surface.",
      },
    );

    expect(accountRpc.expose).not.toHaveBeenCalled();
    await client.close();
    await client.connectAndWait();
    expect(secondRpc.expose).toHaveBeenCalledWith(
      "mobileBrowserPrivacyPresentation.open",
      handler,
      {
        kind: "closed",
        reason:
          "This handler controls an internal execution or presentation surface.",
      },
    );
  });

  it("rejects duplicate exposed shell methods instead of replacing live authority", () => {
    const { client } = clientOver(makeConnection());
    client.expose(
      "mobileBrowserPrivacyPresentation.open",
      async () => undefined,
    );

    expect(() =>
      client.expose(
        "mobileBrowserPrivacyPresentation.open",
        async () => undefined,
      ),
    ).toThrow(
      'Mobile RPC method "mobileBrowserPrivacyPresentation.open" is already exposed',
    );
  });

  it("routes only typed hub destinations over the retained stable hub pipe", async () => {
    const workspaceCall = jest.fn(
      async (
        _target: string,
        _method: { name: string },
        _args: unknown[],
        _options?: unknown,
      ) => ({ workspace: true }),
    );
    const hubCall = jest.fn(
      async (
        _target: string,
        _method: { name: string },
        _args: unknown[],
        _options?: unknown,
      ) => ({ hub: true }),
    );
    const { client } = clientOver(
      makeConnection({
        rpc: makeRpc({ call: workspaceCall }),
        hubControlRpc: makeRpc({ call: hubCall }),
      }),
    );

    await client.connectAndWait();

    await expect(
      client.call("main", mainRpcMethods["workspace.getInfo"], []),
    ).resolves.toEqual({
      workspace: true,
    });
    await expect(
      client.call("main", mainRpcMethods["shellApproval.listPending"], [], {
        destination: { kind: "hub" },
      }),
    ).resolves.toEqual({
      hub: true,
    });
    await expect(
      client.call(
        "main",
        testRpcMethods["hubControl.lookalikeWorkspaceMethod"],
        [],
      ),
    ).resolves.toEqual({ workspace: true });
    expect(
      workspaceCall.mock.calls.some(
        ([target, method, args, options]) =>
          target === "main" &&
          method?.name === "workspace.getInfo" &&
          args.length === 0 &&
          options === undefined,
      ),
    ).toBe(true);
    expect(
      hubCall.mock.calls.some(
        ([target, method, args, options]) =>
          target === "main" &&
          method?.name === "shellApproval.listPending" &&
          args.length === 0 &&
          options === undefined,
      ),
    ).toBe(true);
  });

  it("makes a failed open one terminal job: reported once, never retried by the client", async () => {
    const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const factory = jest
      .fn()
      .mockRejectedValueOnce(new Error("relay warming up"))
      .mockResolvedValueOnce(makeConnection());
    const client = new MobileRpcClient({ connectWorkspace: factory });
    const progress = jest.fn();
    client.onReconnectProgress(progress);

    try {
      await expect(client.connectAndWait()).rejects.toThrow("relay warming up");
      await expect(client.call("main", testRpcMethods.read, [])).rejects.toThrow(
        "relay warming up",
      );
      expect(factory).toHaveBeenCalledTimes(1);
      expect(client.status).toBe("disconnected");
      expect(
        progress.mock.calls.filter(([entry]) => entry.phase === "failed"),
      ).toHaveLength(2);

      // Only an explicit new intent opens another session.
      client.reconnect();
      await client.connectAndWait();
      expect(factory).toHaveBeenCalledTimes(2);
      expect(client.status).toBe("connected");
    } finally {
      error.mockRestore();
    }
  });

  it("forwards transport reconnect progress when that optional hook is available", async () => {
    let emitProgress: ((progress: ReconnectProgress) => void) | undefined;
    const transport = {
      openSession: jest.fn(),
      onReconnectProgress: jest.fn((listener) => {
        emitProgress = listener;
        return jest.fn();
      }),
    } as unknown as RemoteConnection["transport"];
    const { client } = clientOver(makeConnection({ transport }));
    const listener = jest.fn();
    client.onReconnectProgress(listener);

    await client.connectAndWait();
    emitProgress?.({
      attempt: 3,
      phase: "scheduled",
      reason: "network unavailable",
    });

    expect(listener).toHaveBeenCalledWith({
      attempt: 3,
      phase: "scheduled",
      reason: "network unavailable",
    });
  });

  it("waits for an interrupted session to recover before startup resumes", async () => {
    let status: RpcConnectionStatus = "disconnected";
    let publishStatus: ((next: RpcConnectionStatus) => void) | undefined;
    const session = makeSession({
      status: jest.fn(() => status),
      onStatusChange: jest.fn((listener) => {
        publishStatus = listener;
        return jest.fn();
      }),
    });
    const { client } = clientOver(makeConnection({ session }));
    await client.connectAndWait();

    const recovered = client.waitUntilConnected(1_000);
    status = "connected";
    publishStatus?.("connected");

    await expect(recovered).resolves.toBeUndefined();
  });

  it("dispatches server events to subscribed local listeners and unsubscribes cleanly", async () => {
    const eventCallbacks = new Map<string, (event: RpcEventContext) => void>();
    const activeUnsub = jest.fn();
    const rpc = makeRpc({
      on: jest.fn(
        (event: string, callback: (event: RpcEventContext) => void) => {
          eventCallbacks.set(event, callback);
          return activeUnsub;
        },
      ),
    });
    const { client } = clientOver(makeConnection({ rpc }));
    const listener = jest.fn();

    const unsubscribe = client.on("shell-approval:pending-changed", listener);
    await client.connectAndWait();
    eventCallbacks.get("shell-approval:pending-changed")!({
      payload: { pending: ["approval-1"] },
    } as RpcEventContext);

    expect(listener).toHaveBeenCalledWith({
      payload: { pending: ["approval-1"] },
    });
    unsubscribe();
    expect(activeUnsub).toHaveBeenCalledTimes(1);
  });

  it("opens panel sessions through the connection with fresh grant tokens", async () => {
    let openedOptions: Parameters<RemoteConnection["transport"]["openSession"]>[0] | null =
      null;
    let tokenSeenByReady = "";
    const call = jest.fn(
      async (
        _target: string,
        _method: { name: string },
        _args: unknown[],
        _options?: unknown,
      ) => ({ token: "panel-grant-123" }),
    );
    const panelSession = makeSession({
      ready: jest.fn(async () => {
        tokenSeenByReady = await openedOptions!.getToken();
      }),
    });
    const transport = {
      openSession: jest.fn((options) => {
        openedOptions = options;
        return panelSession;
      }),
      onReconnectProgress: jest.fn(() => jest.fn()),
    } as unknown as RemoteConnection["transport"];
    const { client } = clientOver(
      makeConnection({ rpc: makeRpc({ call }), transport }),
    );

    await expect(
      client.openPanelSession("panel:runtime-1" as PanelEntityId, "panel-conn-1"),
    ).resolves.toBe(panelSession);

    expect(transport.openSession).toHaveBeenCalledWith({
      label: "panel panel:runtime-1",
      connectionId: "panel-conn-1",
      getToken: expect.any(Function),
    });
    expect(
      call.mock.calls.some(
        ([target, method, args, options]) =>
          target === "main" &&
          method?.name === "auth.grantConnection" &&
          args[0] === "panel:runtime-1" &&
          options === undefined,
      ),
    ).toBe(true);
    expect(tokenSeenByReady).toBe("panel-grant-123");
  });

  it("closes the pipe (no leak) when disconnect() races an in-flight connect", async () => {
    // Handshake that only resolves when we let it — models a disconnect landing
    // mid-connect (background / dispose-during-connect).
    let resolveConnect!: (connection: RemoteConnection) => void;
    const connection = makeConnection();
    const client = new MobileRpcClient({
      connectWorkspace: () =>
        new Promise<RemoteConnection>((resolve) => (resolveConnect = resolve)),
    });

    client.connect(); // fire-and-forget; session open now pending
    await new Promise((r) => setTimeout(r, 0));
    client.disconnect(); // teardown lands before the handshake resolves
    resolveConnect(connection);
    await new Promise((r) => setTimeout(r, 0)); // let the pending handshake settle

    // The produced pipe is closed (keepalive gone), not adopted as "connected".
    expect(connection.close).toHaveBeenCalledTimes(1);
    expect(client.status).not.toBe("connected");
  });

  it("surfaces composed teardown failures through reconnect progress", async () => {
    const errorSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const connection = makeConnection({
      close: jest.fn(async () => {
        throw new MobileConnectionAggregateError(
          [new Error("workspace close"), new Error("hub close")],
          "connections failed to close",
        );
      }),
    });
    const { client } = clientOver(connection);
    const progress = jest.fn();
    client.onReconnectProgress(progress);

    try {
      await client.connectAndWait();
      client.disconnect();
      await new Promise((resolve) => setTimeout(resolve, 0));
    } finally {
      errorSpy.mockRestore();
    }

    expect(progress).toHaveBeenCalledWith(
      expect.objectContaining({
        attempt: 0,
        phase: "failed",
        reason: expect.stringContaining("Disconnect teardown failed"),
      }),
    );
    expect(client.status).toBe("disconnected");
  });

  it("forwards both Iroh recovery kinds through the RpcClient observer shape", async () => {
    let emitRecovery:
      | ((kind: RecoveryKind) => void | Promise<void>)
      | undefined;
    const client = new MobileRpcClient({
      connectWorkspace: async (onRecovery) => {
        emitRecovery = onRecovery;
        return makeConnection();
      },
    });
    const observed = jest.fn();
    client.onRecovery((kind) => observed(kind));

    await client.connectAndWait();
    expect(client.status).toBe("connected");
    await emitRecovery?.("cold-recover");
    await emitRecovery?.("resubscribe");

    expect(observed.mock.calls).toEqual([["cold-recover"], ["resubscribe"]]);
    expect(client.status).toBe("connected");
  });

  it("isolates synchronous recovery observer failures without blocking the Iroh owner", async () => {
    let recover!: (kind: RecoveryKind) => void | Promise<void>;
    const client = new MobileRpcClient({
      connectWorkspace: async (onRecovery) => {
        recover = onRecovery;
        return makeConnection();
      },
    });
    const failure = new Error("Subscription replay failed");
    const asyncFailure = new Error("Async observer failed");
    const log = jest.spyOn(console, "error").mockImplementation(() => {});
    const completed = jest.fn();
    client.onRecovery((kind) => {
      if (kind !== "resubscribe") return;
      throw failure;
    });
    client.onRecovery((kind) => {
      if (kind === "resubscribe") completed();
    });
    client.onRecovery(async (kind) => {
      if (kind === "resubscribe") throw asyncFailure;
    });
    await client.connectAndWait();
    expect(recover("resubscribe")).toBeUndefined();
    await Promise.resolve();
    expect(completed).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(
      "[MobileRpcClient] Recovery observer failed:",
      failure,
    );
    expect(log).toHaveBeenCalledWith(
      "[MobileRpcClient] Async recovery observer failed:",
      asyncFailure,
    );
    log.mockRestore();
    await client.close();
  });
});

describe("MobileRpcClient session ownership", () => {
  it("retires status, progress, events and recovery before close; old callbacks cannot affect a replacement", async () => {
    const recoveries: Array<(kind: RecoveryKind) => void | Promise<void>> = [];
    const statuses: Array<(status: RpcConnectionStatus) => void> = [];
    const progresses: Array<(progress: ReconnectProgress) => void> = [];
    const events: Array<(event: RpcEventContext) => void> = [];
    const stops = [jest.fn(), jest.fn(), jest.fn()];
    const connections = [0, 1].map((index) =>
      makeConnection({
        session: makeSession({
          onStatusChange: (listener) => {
            statuses[index] = listener;
            return stops[0]!;
          },
        }),
        transport: {
          openSession: jest.fn(),
          onReconnectProgress: (
            listener: (progress: ReconnectProgress) => void,
          ) => {
            progresses[index] = listener;
            return stops[1]!;
          },
        } as unknown as RemoteConnection["transport"],
        rpc: makeRpc({
          on: (_name: string, listener: (event: RpcEventContext) => void) => {
            events[index] = listener;
            return stops[2]!;
          },
        }),
      }),
    );
    let finishClose!: () => void;
    connections[0]!.close = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          finishClose = resolve;
        }),
    );
    const factory = jest.fn(
      async (recover: (kind: RecoveryKind) => void | Promise<void>) => {
        const index = recoveries.length;
        recoveries.push(recover);
        return connections[index]!;
      },
    );
    const client = new MobileRpcClient({ connectWorkspace: factory });
    const status = jest.fn();
    const progress = jest.fn();
    const event = jest.fn();
    const recovery = jest.fn();
    client.onStatusChange(status);
    client.onReconnectProgress(progress);
    client.on("owned-event", event);
    client.onRecovery((kind) => {
      if (kind === "resubscribe") recovery(kind);
    });
    await client.connectAndWait();
    statuses[0]!("connecting");
    expect(status).toHaveBeenLastCalledWith("connecting");
    const closing = client.close();
    expect(stops.every((stop) => stop.mock.calls.length === 1)).toBe(true);
    const replacement = client.connectAndWait();
    expect(factory).toHaveBeenCalledTimes(1);
    finishClose();
    await Promise.all([closing, replacement]);
    status.mockClear();
    progress.mockClear();
    event.mockClear();
    recovery.mockClear();
    statuses[0]!("disconnected");
    progresses[0]!({ attempt: 1, phase: "failed", reason: "retired" });
    events[0]!({ payload: "retired" } as RpcEventContext);
    await recoveries[0]!("resubscribe");
    expect(status).not.toHaveBeenCalled();
    expect(progress).not.toHaveBeenCalled();
    expect(event).not.toHaveBeenCalled();
    expect(recovery).not.toHaveBeenCalled();
    statuses[1]!("connecting");
    await recoveries[1]!("resubscribe");
    events[1]!({ payload: "current" } as RpcEventContext);
    expect(status).toHaveBeenCalledWith("connecting");
    expect(recovery).toHaveBeenCalledTimes(1);
    expect(event).toHaveBeenCalledTimes(1);
    await client.close();
  });

  it("does not clear a newer in-flight connection when a retired handshake completes", async () => {
    const pending: Array<(connection: RemoteConnection) => void> = [];
    const factory = jest.fn(
      () =>
        new Promise<RemoteConnection>((resolve) => {
          pending.push(resolve);
        }),
    );
    const client = new MobileRpcClient({ connectWorkspace: factory });
    const first = client.call("main", testRpcMethods.read, []);
    const retired = expect(first).rejects.toThrow("superseded");
    await Promise.resolve();
    await client.close();
    const second = client.call("main", testRpcMethods.read, []);
    await Promise.resolve();
    const abandoned = makeConnection();
    pending[0]!(abandoned);
    await retired;
    expect(abandoned.close).toHaveBeenCalledTimes(1);
    const third = client.call("main", testRpcMethods.read, []);
    expect(factory).toHaveBeenCalledTimes(2);
    pending[1]!(
      makeConnection({
        rpc: makeRpc({ call: jest.fn(async () => "current") }),
      }),
    );
    await expect(second).resolves.toBe("current");
    await expect(third).resolves.toBe("current");
    await client.close();
  });
});

describe("MobileRpcClient connect lifetime boundaries", () => {
  it("ignores a retired handshake rejection after its replacement connects", async () => {
    let rejectFirst!: (error: Error) => void;
    const factory = jest
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<RemoteConnection>((_resolve, reject) => {
            rejectFirst = reject;
          }),
      )
      .mockResolvedValueOnce(makeConnection());
    const client = new MobileRpcClient({ connectWorkspace: factory });
    const first = client.connectAndWait();
    const retired = expect(first).rejects.toThrow("superseded");
    await Promise.resolve();
    await client.close();
    await client.connectAndWait();
    const status = jest.fn();
    client.onStatusChange(status);
    rejectFirst(new Error("old network failure"));
    await retired;
    expect(status).not.toHaveBeenCalled();
    expect(client.status).toBe("connected");
    expect(factory).toHaveBeenCalledTimes(2);
    await client.close();
  });

  it("does not reconnect after its requested lifetime is canceled while old close is pending", async () => {
    let finish!: () => void;
    const old = makeConnection({
      close: jest.fn(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      ),
    });
    const factory = jest.fn(async () => old);
    const client = new MobileRpcClient({ connectWorkspace: factory });
    await client.connectAndWait();
    client.reconnect();
    const canceled = client.close();
    finish();
    await canceled;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(factory).toHaveBeenCalledTimes(1);
    expect(client.status).toBe("disconnected");
  });

  it("closes every subscription and native connection even when unsubscribe throws", async () => {
    const stopStatus = jest.fn(() => {
      throw new Error("status cleanup failed");
    });
    const stopProgress = jest.fn();
    const stopEvent = jest.fn();
    const connection = makeConnection({
      session: makeSession({ onStatusChange: () => stopStatus }),
      transport: {
        openSession: jest.fn(),
        onReconnectProgress: () => stopProgress,
      } as unknown as RemoteConnection["transport"],
      rpc: makeRpc({ on: () => stopEvent }),
    });
    const client = new MobileRpcClient({
      connectWorkspace: async () => connection,
    });
    client.on("owned", () => undefined);
    await client.connectAndWait();
    await expect(client.close()).rejects.toThrow(
      "resources could not all be closed",
    );
    expect(stopStatus).toHaveBeenCalledTimes(1);
    expect(stopProgress).toHaveBeenCalledTimes(1);
    expect(stopEvent).toHaveBeenCalledTimes(1);
    expect(connection.close).toHaveBeenCalledTimes(1);
    expect(client.status).toBe("disconnected");
  });
});

describe("MobileRpcClient shared initial connection job", () => {
  it("shares one open session between concurrent callers and executes a waiting user mutation only once", async () => {
    const mutation = jest.fn(async () => "saved");
    let finishOpen!: (connection: RemoteConnection) => void;
    const factory = jest.fn(
      () =>
        new Promise<RemoteConnection>((resolve) => {
          finishOpen = resolve;
        }),
    );
    const client = new MobileRpcClient({ connectWorkspace: factory });
    try {
      const first = client.connectAndWait();
      const second = client.connectAndWait();
      const write = client.call("main", testRpcMethods.write, ["value"]);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(factory).toHaveBeenCalledTimes(1);
      expect(mutation).not.toHaveBeenCalled();
      finishOpen(makeConnection({ rpc: makeRpc({ call: mutation }) }));
      await Promise.all([first, second]);
      await expect(write).resolves.toBe("saved");
      expect(factory).toHaveBeenCalledTimes(1);
      expect(mutation).toHaveBeenCalledTimes(1);
    } finally {
      await client.close();
    }
  });

  it.each(["missing-control", "expose", "listener"] as const)(
    "never publishes an invalid %s connection and finishes its exact cleanup before another job",
    async (phase) => {
      const error = jest
        .spyOn(console, "error")
        .mockImplementation(() => undefined);
      let finishClose!: () => void;
      let closing!: () => void;
      const closeStarted = new Promise<void>((resolve) => {
        closing = resolve;
      });
      const invalidRpc = makeRpc({
        call: jest.fn(),
        ...(phase === "expose"
          ? {
              expose: () => {
                throw new Error("expose failed");
              },
            }
          : {}),
        ...(phase === "listener"
          ? {
              on: () => {
                throw new Error("listener failed");
              },
            }
          : {}),
      });
      const stopStatus = jest.fn();
      const invalid = makeConnection({
        rpc: invalidRpc,
        ...(phase === "missing-control" ? { hubControlRpc: undefined } : {}),
        session: makeSession({ onStatusChange: () => stopStatus }),
        close: jest.fn(() => {
          closing();
          return new Promise<void>((resolve) => {
            finishClose = resolve;
          });
        }),
      });
      const mutation = jest.fn(async () => "current");
      const { client, factory } = clientOver(
        invalid,
        makeConnection({ rpc: makeRpc({ call: mutation }) }),
      );
      client.expose("owned-handler", async () => undefined);
      client.on("owned-event", () => undefined);
      try {
        const request = client.call("main", testRpcMethods.write, []);
        const rejected = expect(request).rejects.toThrow();
        await closeStarted;
        expect(factory).toHaveBeenCalledTimes(1);
        expect(invalidRpc.call).not.toHaveBeenCalled();
        expect(client.status).toBe("connecting");
        finishClose();
        await rejected;
        expect(invalid.close).toHaveBeenCalledTimes(1);
        if (phase === "listener") expect(stopStatus).toHaveBeenCalledTimes(1);
        expect(mutation).not.toHaveBeenCalled();

        client.reconnect();
        await client.connectAndWait();
        await expect(client.call("main", testRpcMethods.write, [])).resolves.toBe(
          "current",
        );
        expect(factory).toHaveBeenCalledTimes(2);
        expect(mutation).toHaveBeenCalledTimes(1);
      } finally {
        await client.close();
        error.mockRestore();
      }
    },
  );
});

describe("MobileRpcClient trust revocation", () => {
  it("is terminal: the connection closes and no call or reconnect opens another session", async () => {
    const log = jest.spyOn(console, "error").mockImplementation(() => undefined);
    let closed!: (closed: { reason: string; message: string }) => void;
    const session = makeSession({
      onClosed: jest.fn((listener) => {
        closed = listener;
        return jest.fn();
      }) as unknown as RemoteSession["onClosed"],
    });
    const connection = makeConnection({ session });
    const { client, factory } = clientOver(connection);
    try {
      await client.connectAndWait();
      expect(client.status).toBe("connected");

      closed({ reason: "trust-revoked", message: "trust withdrawn by the owner" });
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(client.status).toBe("disconnected");
      expect(connection.close).toHaveBeenCalledTimes(1);
      await expect(client.call("main", testRpcMethods.read, [])).rejects.toBeInstanceOf(
        ClientTrustRevokedError,
      );
      client.reconnect();
      await expect(client.connectAndWait()).rejects.toThrow("trust withdrawn by the owner");
      expect(factory).toHaveBeenCalledTimes(1);
    } finally {
      log.mockRestore();
    }
  });

  it("treats other session endings as an ordinary closed session, not revocation", async () => {
    let closed!: (closed: { reason: string; message: string }) => void;
    const session = makeSession({
      onClosed: jest.fn((listener) => {
        closed = listener;
        return jest.fn();
      }) as unknown as RemoteSession["onClosed"],
    });
    const { client, factory } = clientOver(makeConnection({ session }));
    await client.connectAndWait();

    closed({ reason: "server-closed", message: "credential revoked" });
    client.reconnect();
    await client.connectAndWait();

    expect(factory).toHaveBeenCalledTimes(2);
    await client.close();
  });
});

it("ignores recovery before adoption and from a failed attempt after an explicit reconnect", async () => {
  const callbacks: Array<(kind: RecoveryKind) => void | Promise<void>> = [];
  const error = jest.spyOn(console, "error").mockImplementation(() => undefined);
  const factory = jest.fn(
    async (recover: (kind: RecoveryKind) => void | Promise<void>) => {
      callbacks.push(recover);
      await recover("resubscribe");
      if (callbacks.length === 1) throw new Error("first handshake failed");
      return makeConnection();
    },
  );
  const client = new MobileRpcClient({ connectWorkspace: factory });
  const recovered = jest.fn();
  client.onRecovery((kind) => {
    if (kind === "resubscribe") recovered(kind);
  });
  try {
    await expect(client.connectAndWait()).rejects.toThrow("first handshake failed");
    client.reconnect();
    await client.connectAndWait();
    expect(factory).toHaveBeenCalledTimes(2);
    expect(recovered).not.toHaveBeenCalled();
    await callbacks[0]!("resubscribe");
    expect(recovered).not.toHaveBeenCalled();
    await callbacks[1]!("resubscribe");
    expect(recovered).toHaveBeenCalledTimes(1);
  } finally {
    await client.close();
    error.mockRestore();
  }
});

it("makes every reconnect caller await retirement and preserves failed cleanup for later close", async () => {
  const logged = jest
    .spyOn(console, "error")
    .mockImplementation(() => undefined);
  let failClose!: (error: Error) => void;
  const connection = makeConnection({
    close: jest.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          failClose = reject;
        }),
    ),
  });
  const factory = jest.fn(async () => connection);
  const client = new MobileRpcClient({ connectWorkspace: factory });
  try {
    await client.connectAndWait();
    client.reconnect();
    const request = client.call("main", testRpcMethods.write, []);
    const rejected = expect(request).rejects.toThrow(
      "resources could not all be closed",
    );
    const connected = client.connectAndWait();
    const connectionRejected = expect(connected).rejects.toThrow(
      "resources could not all be closed",
    );
    expect(factory).toHaveBeenCalledTimes(1);
    failClose(new Error("native cleanup failed"));
    await Promise.all([rejected, connectionRejected]);
    await expect(client.call("main", testRpcMethods.write, [])).rejects.toThrow(
      "resources could not all be closed",
    );
    await expect(client.close()).rejects.toThrow(
      "resources could not all be closed",
    );
    client.reconnect();
    await expect(client.connectAndWait()).rejects.toThrow(
      "resources could not all be closed",
    );
    expect(factory).toHaveBeenCalledTimes(1);
    expect(connection.close).toHaveBeenCalledTimes(1);
    expect(client.status).toBe("disconnected");
  } finally {
    logged.mockRestore();
  }
});

const testRpcMethods = createReceiverRpcMethods<{
  "demo.hello"(name: string): Promise<{ ok: boolean }>;
  "hubControl.lookalikeWorkspaceMethod"(): Promise<unknown>;
  read(): Promise<string>;
  write(value?: string): Promise<string>;
}>(["demo.hello", "hubControl.lookalikeWorkspaceMethod", "read", "write"]);
