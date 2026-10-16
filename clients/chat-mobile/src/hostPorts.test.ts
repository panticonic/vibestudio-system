import { createFakeClientHost } from "@workspace/client-kit-native/testing";
import { conversationState, createClientHostPorts, LAST_CONVERSATION_KEY } from "./hostPorts";

describe("conversationState", () => {
  it("applies patches with null clearing a key and tells the owner which channel is open", async () => {
    const seen: string[] = [];
    const state = conversationState({}, (channel) => seen.push(channel));
    const changed = jest.fn();
    state.subscribe(changed);

    await state.patch({ channelName: "chan-1", agentSource: "agents/a" });
    expect(state.get()).toEqual({ channelName: "chan-1", agentSource: "agents/a" });
    await state.patch({ agentSource: null });
    expect(state.get()).toEqual({ channelName: "chan-1" });
    expect(seen).toEqual(["chan-1", "chan-1"]);
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it("starts from the channel the person opened", () => {
    expect(conversationState({ channelName: "chan-9" }, () => undefined).get()).toEqual({
      channelName: "chan-9",
    });
  });
});

describe("createClientHostPorts", () => {
  const workspace = {
    rpc: {
      call: jest.fn(),
      on: jest.fn(() => () => undefined),
      streamReadable: jest.fn(),
      status: jest.fn(),
      onStatusChange: jest.fn(),
      onRecovery: jest.fn(),
    },
  };

  it("builds each conversation's ports over the device's workspace session", async () => {
    const host = await createFakeClientHost({ granted: ["device-session", "hub-control"] });
    const factory = createClientHostPorts({ workspace: workspace as never }, host.api, jest.fn());
    const ports = factory({ key: "native-chat:1", channelName: "chan-1", contextId: "ctx-1" });

    expect(ports.contextId).toBe("ctx-1");
    expect(ports.instanceId).toBe("native-chat:1");
    expect(ports.rpc).toBe(workspace.rpc);
    expect(ports.state.get()).toEqual({ channelName: "chan-1" });
  });

  it("remembers the channel a new conversation settles on", async () => {
    const host = await createFakeClientHost({ granted: ["device-session", "hub-control"] });
    const factory = createClientHostPorts({ workspace: workspace as never }, host.api, jest.fn());
    const ports = factory({ key: "native-chat:2", channelName: null, contextId: "ctx-1" });

    await ports.state.patch({ channelName: "chan-new" });
    await Promise.resolve();
    expect(host.state.get(LAST_CONVERSATION_KEY)).toBe("chan-new");
  });

  it("reports a failure to remember rather than dropping it", async () => {
    const host = await createFakeClientHost({
      granted: ["device-session"],
      handlers: {
        "state.set": () => {
          throw new Error("disk full");
        },
      },
    });
    const report = jest.fn();
    const factory = createClientHostPorts({ workspace: workspace as never }, host.api, report);
    await factory({ key: "native-chat:3", channelName: null, contextId: "c" }).state.patch({
      channelName: "chan-x",
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(report).toHaveBeenCalledWith("Could not remember the open conversation", expect.any(Error));
  });
});
