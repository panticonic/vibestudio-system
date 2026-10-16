import type { RnClientApi } from "@vibestudio/rn-client-api";
import { HOME_CONTEXT_KEY, openChatConnection } from "./chatSession";

type Method = { name: string; invoke: (args: unknown[], send: (wire: unknown[]) => unknown) => unknown };

function fakeApi(options: { state?: Record<string, string>; workspaceFails?: boolean } = {}) {
  const state = new Map(Object.entries(options.state ?? {}));
  const calls: string[] = [];
  const closed: string[] = [];
  const control = {
    rpc: {
      call: (_target: string, method: Method, args: unknown[]) =>
        method.invoke(args, async () => {
          calls.push(method.name);
          const entry = (workspaceId: string, privateRole: "personal" | "system") => ({
            workspaceId,
            name: workspaceId,
            lastOpened: 0,
            running: true,
            pendingApprovalCount: 0,
            privateRole,
          });
          return { personal: entry("ws-personal", "personal"), system: entry("ws-system", "system") };
        }),
    },
    close: async () => void closed.push("control"),
  };
  const workspace = {
    rpc: {
      call: async (_target: string, method: Method) => {
        calls.push(method.name);
        return { contextId: "ctx-new" };
      },
    },
    close: async () => void closed.push("workspace"),
  };
  const account = {
    control,
    openWorkspace: async (id: string) => {
      calls.push(`openWorkspace:${id}`);
      if (options.workspaceFails) throw new Error("workspace unreachable");
      return workspace;
    },
    close: async () => void closed.push("account"),
  };
  const api = {
    client: { clientId: "chat", deviceId: "dev1" },
    session: { openAccount: async () => account },
    state: {
      get: async (key: string) => state.get(key) ?? null,
      set: async (key: string, value: string) => void state.set(key, value),
    },
  } as unknown as RnClientApi;
  return { api, state, calls, closed, workspace };
}

describe("openChatConnection", () => {
  it("opens the Personal workspace on the device's session and creates the home context once", async () => {
    const { api, state, calls, workspace } = fakeApi();
    const chat = await openChatConnection(api);

    expect(chat.workspaceId).toBe("ws-personal");
    expect(chat.contextId).toBe("ctx-new");
    expect(chat.connection.rpc).toBe(workspace.rpc);
    expect(chat.connection.clientId).toBe("chat:dev1");
    expect(state.get(HOME_CONTEXT_KEY)).toBe("ctx-new");
    expect(calls).toEqual([
      "hubControl.ensureUserWorkspaces",
      "openWorkspace:ws-personal",
      "runtime.createContext",
    ]);
  });

  it("reuses the remembered home context", async () => {
    const { api, calls } = fakeApi({ state: { [HOME_CONTEXT_KEY]: "ctx-old" } });
    const chat = await openChatConnection(api);
    expect(chat.contextId).toBe("ctx-old");
    expect(calls).not.toContain("runtime.createContext");
  });

  it("closes the account and rethrows the original failure when the workspace cannot open", async () => {
    const { api, closed } = fakeApi({ workspaceFails: true });
    await expect(openChatConnection(api)).rejects.toThrow("workspace unreachable");
    expect(closed).toEqual(["account"]);
  });

  it("closes through the account", async () => {
    const { api, closed } = fakeApi();
    await (await openChatConnection(api)).close();
    expect(closed).toEqual(["account"]);
  });
});
