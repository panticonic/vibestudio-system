import { describe, expect, it, vi } from "vitest";
import { mainRpcMethods } from "@vibestudio/service-schemas/mainRpc";
import { createRpcOwners } from "./ownerRpc";
import { fakeHost } from "./testing";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("rpc owners", () => {
  it("routes each owner's envelopes to its own destination, as the client principal", async () => {
    const fake = fakeHost();
    const owners = createRpcOwners(fake.host);
    const personal = owners.open({ kind: "workspace", workspaceId: "personal-ws" });
    const hub = owners.open({ kind: "hub" });
    void personal.rpc.call("main", mainRpcMethods["runtime.listEntities"], [{ kind: "do" }]).catch(() => undefined);
    void hub.rpc.call("main", mainRpcMethods["runtime.createContext"], [{}]).catch(() => undefined);
    await vi.waitFor(() => expect(fake.sent).toHaveLength(2));

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
    const owners = createRpcOwners(fake.host);
    const personal = owners.open({ kind: "workspace", workspaceId: "personal-ws" });
    personal.close();
    await expect(personal.rpc.call("main", mainRpcMethods["runtime.listEntities"], [{ kind: "do" }])).rejects.toThrow();
    expect(fake.sent).toHaveLength(0);
    owners.close();
  });

  it("settles a call still in flight when its owner closes, and releases the endpoint", async () => {
    const fake = fakeHost();
    const owners = createRpcOwners(fake.host);
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
    const owners = createRpcOwners(fake.host);
    owners.close();
    expect(() => owners.open({ kind: "workspace", workspaceId: "personal-ws" })).toThrow(/closed/);
    expect(fake.recoveryListenerCount()).toBe(0);
  });

  it("takes recovery only for the workspace it is routed to, and releases it on close", async () => {
    const fake = fakeHost();
    const owners = createRpcOwners(fake.host);
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
    const owners = createRpcOwners(fake.host);
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
