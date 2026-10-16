import { describe, expect, it, vi } from "vitest";

// A plain function behind the mock: a rejection returned from a `vi.fn` is reported as unhandled.
const hub = vi.hoisted(() => ({ ensure: (async () => ({})) as () => Promise<unknown> }));
vi.mock("@vibestudio/shared/typedRpcServiceClient", () => ({
  createTypedRpcServiceClient: () => ({ ensureUserWorkspaces: () => hub.ensure() }),
}));
vi.mock("@workspace/approvals-core", () => ({ createApprovalsClient: () => ({ marker: "approvals" }) }));

import type { RpcDestination } from "@vibestudio/rpc";
import type { RpcOwners } from "./ownerRpc";
import { openChatSession } from "./session";

function fakeOwners() {
  const opened: Array<{ destination: RpcDestination; closed: boolean }> = [];
  const owners = {
    open(destination: RpcDestination) {
      const record = { destination, closed: false };
      opened.push(record);
      return {
        rpc: { on: vi.fn(), call: vi.fn(), destination },
        close: () => {
          record.closed = true;
        },
      };
    },
    close: vi.fn(),
  } as unknown as RpcOwners;
  return { owners, opened };
}

describe("openChatSession", () => {
  it("finds the Personal workspace over the hub and keeps only that session open", async () => {
    hub.ensure = async () => ({ personal: { workspaceId: "personal-ws" }, system: { workspaceId: "s" } });
    const { owners, opened } = fakeOwners();
    const session = await openChatSession(owners, { runtimeId: "client:chat:web:dev-1" });

    expect(opened.map((entry) => entry.destination)).toEqual([
      { kind: "hub" },
      { kind: "workspace", workspaceId: "personal-ws" },
    ]);
    expect(opened.map((entry) => entry.closed)).toEqual([true, false]);
    expect(session.workspaceId).toBe("personal-ws");
    expect(session.clientId).toBe("client:chat:web:dev-1");
    session.close();
    expect(opened[1]!.closed).toBe(true);
  });

  it("closes the hub session and reports the original failure when the lookup fails", async () => {
    const failure = new Error("hub unreachable");
    hub.ensure = async () => {
      throw failure;
    };
    const { owners, opened } = fakeOwners();
    await expect(openChatSession(owners, { runtimeId: "r" })).rejects.toBe(failure);
    expect(opened).toHaveLength(1);
    expect(opened[0]!.closed).toBe(true);
  });
});
