import { describe, expect, it, vi } from "vitest";
import { mainRpcMethods } from "@vibestudio/service-schemas/mainRpc";
import type { RpcEnvelope } from "@vibestudio/rpc";
import type { WorkspaceConnectionState } from "@vibestudio/shared/workspaceConnection";
import { createOwnerRpcs, type OwnerRpcHost } from "./ownerRpc";

/** A fake desktop host: the transport and connection bridges, with handles to drive them. */
function fakeHost(initial: Partial<WorkspaceConnectionState> = {}) {
  const sent: RpcEnvelope[] = [];
  const recoveryListeners = new Map<string, Set<(workspaceId?: string) => void | Promise<void>>>();
  const connectionListeners = new Set<(state: WorkspaceConnectionState) => void>();
  let connection = {
    version: 1,
    phase: "online",
    mode: "local",
    since: 0,
    ...initial,
  } as WorkspaceConnectionState;
  const host: OwnerRpcHost = {
    transport: {
      identity: { workspaceId: "system-ws", runtimeId: "client:chat:web:dev-1" },
      send: async (envelope) => {
        sent.push(envelope);
      },
      onMessage: () => () => undefined,
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
    sent,
    recover: (kind: "resubscribe" | "cold-recover", workspaceId?: string) =>
      Promise.all([...(recoveryListeners.get(kind) ?? [])].map((handler) => handler(workspaceId))),
    recoveryListenerCount: () => [...recoveryListeners.values()].reduce((n, set) => n + set.size, 0),
    setConnection(state: Partial<WorkspaceConnectionState>) {
      connection = { ...connection, ...state };
      for (const listener of [...connectionListeners]) listener(connection);
    },
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("rpc owners", () => {
  it("runs the owner's recovery work after the RPC core's, only for its workspace", async () => {
    const fake = fakeHost();
    const owners = createOwnerRpcs(fake.host);
    const order: string[] = [];
    const owner = owners.open(
      { kind: "workspace", workspaceId: "ws" },
      { recovery: { run: (kind) => void order.push(`coordinator:${kind}`) } }
    );
    owner.rpc.onRecovery((kind) => void order.push(`core:${kind}`));
    await fake.recover("resubscribe", "other");
    await fake.recover("resubscribe", "ws");
    expect(order).toEqual(["core:resubscribe", "coordinator:resubscribe"]);
    owners.close();
  });

  it("routes each owner's envelopes to its own destination, as the client principal", async () => {
    const fake = fakeHost();
    const owners = createOwnerRpcs(fake.host);
    const personal = owners.open({ kind: "workspace", workspaceId: "personal-ws" });
    const hub = owners.open({ kind: "hub" });
    void personal.rpc.call("main", mainRpcMethods["runtime.listEntities"], [{ kind: "do" }]).catch(() => undefined);
    void hub.rpc.call("main", mainRpcMethods["runtime.createContext"], [{}]).catch(() => undefined);
    await vi.waitFor(() => expect(fake.sent).toHaveLength(2), { timeout: 5000 });

    expect(fake.sent.map((envelope) => envelope.destination)).toEqual(
      expect.arrayContaining([
        { kind: "workspace", workspaceId: "personal-ws" },
        { kind: "hub" },
      ])
    );
    owners.close();
  });

  it("fails calls through a closed owner instead of reaching the host", async () => {
    const fake = fakeHost();
    const owners = createOwnerRpcs(fake.host);
    const personal = owners.open({ kind: "workspace", workspaceId: "personal-ws" });
    personal.close();
    await expect(personal.rpc.call("main", mainRpcMethods["runtime.listEntities"], [{ kind: "do" }])).rejects.toThrow();
    expect(fake.sent).toHaveLength(0);
    owners.close();
  });

  it("settles a call still in flight when its owner closes, and releases the endpoint", async () => {
    const fake = fakeHost();
    const owners = createOwnerRpcs(fake.host);
    const personal = owners.open({ kind: "workspace", workspaceId: "personal-ws" });
    const pending = personal.rpc.call("main", mainRpcMethods["runtime.createContext"], [{}]);
    const outcome = pending.then(
      () => "resolved",
      (error: unknown) => (error as Error).message
    );
    await vi.waitFor(() => expect(fake.sent).toHaveLength(1));
    personal.close();
    await expect(outcome).resolves.toMatch(/retired|closed/);
    expect(fake.recoveryListenerCount()).toBe(0);
    owners.close();
  });

  it("opens nothing once closed, so a session that finishes opening late leaves nothing behind", () => {
    const fake = fakeHost();
    const owners = createOwnerRpcs(fake.host);
    owners.close();
    expect(() => owners.open({ kind: "workspace", workspaceId: "personal-ws" })).toThrow(/closed/);
    expect(fake.recoveryListenerCount()).toBe(0);
  });

  it("takes recovery only for the workspace it is routed to, and releases it on close", async () => {
    const fake = fakeHost();
    const owners = createOwnerRpcs(fake.host);
    const personal = owners.open({ kind: "workspace", workspaceId: "personal-ws" });
    const seen: string[] = [];
    personal.rpc.onRecovery((kind) => void seen.push(kind));
    await fake.recover("resubscribe", "other-ws");
    await fake.recover("resubscribe", "personal-ws");
    expect(seen).toEqual(["resubscribe"]);

    const hub = owners.open({ kind: "hub" });
    hub.rpc.onRecovery((kind) => void seen.push(`hub:${kind}`));
    await fake.recover("cold-recover", "personal-ws");
    expect(seen).toEqual(["resubscribe", "cold-recover"]);

    owners.close();
    expect(fake.recoveryListenerCount()).toBe(0);
  });

  it("reports the host's availability fact as its transport status", async () => {
    const fake = fakeHost({ phase: "starting" });
    const owners = createOwnerRpcs(fake.host);
    const personal = owners.open({ kind: "workspace", workspaceId: "personal-ws" });
    const statuses: string[] = [];
    personal.rpc.onStatusChange((status) => void statuses.push(status));
    await flush();
    expect(personal.rpc.status()).toBe("connecting");
    fake.setConnection({ phase: "online" });
    expect(personal.rpc.status()).toBe("connected");
    fake.setConnection({ phase: "ended" });
    expect(personal.rpc.status()).toBe("disconnected");
    expect(statuses).toEqual(["connected", "disconnected"]);
    owners.close();
  });
});
