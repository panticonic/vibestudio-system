import { act, create } from "react-test-renderer";
import { createFakeClientHost } from "@workspace/client-kit-native/testing";
import { ChatClient } from "./ChatClient";

const mockScreens: Array<Record<string, unknown>> = [];
jest.mock("@workspace/agentic-chat-native", () => {
  const palette = {
    background: "#fff",
    text: "#000",
    textSecondary: "#555",
    accent: "#00f",
    accentSoft: "#eef",
    border: "#ccc",
  };
  return {
    lightChatNativeTheme: palette,
    darkChatNativeTheme: palette,
    ChatScreen: (props: Record<string, unknown>) => {
      mockScreens.push(props);
      return null;
    },
  };
});
const mockOpenChatConnection = jest.fn();
jest.mock("./chatSession", () => ({ openChatConnection: (...args: unknown[]) => mockOpenChatConnection(...args) }));

const chat = () => ({
  workspaceId: "ws-personal",
  workspace: {
    rpc: {
      call: jest.fn(),
      on: jest.fn(() => () => undefined),
      streamReadable: jest.fn(),
      status: jest.fn(),
      onStatusChange: jest.fn(),
      onRecovery: jest.fn(),
    },
  },
  contextId: "ctx-1",
  connection: { clientId: "chat:dev1", rpc: {} },
  close: jest.fn(async () => undefined),
});

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setImmediate(resolve));
  });
}

beforeEach(() => {
  mockScreens.length = 0;
  mockOpenChatConnection.mockReset();
});

describe("ChatClient", () => {
  it("renders the chat screen over the workspace connection and resumes the last conversation", async () => {
    const host = await createFakeClientHost({ granted: ["device-session", "hub-control", "clipboard"] });
    host.state.set("chat.lastConversation", "chan-7");
    const connection = chat();
    mockOpenChatConnection.mockResolvedValue(connection);

    let tree!: ReturnType<typeof create>;
    await act(async () => {
      tree = create(<ChatClient api={host.api} />);
    });
    await settle();

    const props = mockScreens.at(-1)!;
    expect(props["channelName"]).toBe("chan-7");
    expect(props["contextId"]).toBe("ctx-1");
    expect(props["connection"]).toBe(connection.connection);
    expect(typeof props["copy"]).toBe("function");
    expect(typeof props["hostPorts"]).toBe("function");

    await act(async () => tree.unmount());
    expect(connection.close).toHaveBeenCalledTimes(1);
  });

  it("opens the conversation a launch intent names and a later intent replaces it", async () => {
    const host = await createFakeClientHost({
      granted: ["device-session", "hub-control"],
      intent: { name: "open-conversation", params: { conversation: "chan-launch" } },
    });
    mockOpenChatConnection.mockResolvedValue(chat());
    await act(async () => {
      create(<ChatClient api={host.api} />);
    });
    await settle();
    expect(mockScreens.at(-1)!["channelName"]).toBe("chan-launch");
    expect(mockScreens.at(-1)!["copy"]).toBeUndefined();

    await act(async () => {
      host.emit({ type: "intent", intent: { name: "open-conversation", params: { conversation: "chan-next" } } });
    });
    expect(mockScreens.at(-1)!["channelName"]).toBe("chan-next");
  });

  it("starts a new chat for a share with the shared text in its composer", async () => {
    const host = await createFakeClientHost({ granted: ["device-session", "hub-control"] });
    mockOpenChatConnection.mockResolvedValue(chat());
    await act(async () => {
      create(<ChatClient api={host.api} />);
    });
    await settle();
    expect(mockScreens.at(-1)!["initialInput"]).toBeUndefined();
    await act(async () => {
      host.emit({ type: "intent", intent: { name: "share", params: { text: "hello from another app" } } });
    });
    expect(mockScreens.at(-1)!["channelName"]).toBeNull();
    expect(mockScreens.at(-1)!["initialInput"]).toBe("hello from another app");
  });

  it("shows an opening failure with a Retry that opens again", async () => {
    const host = await createFakeClientHost({ granted: ["device-session", "hub-control"] });
    mockOpenChatConnection.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(chat());
    let tree!: ReturnType<typeof create>;
    await act(async () => {
      tree = create(<ChatClient api={host.api} />);
    });
    await settle();
    expect(JSON.stringify(tree.toJSON())).toContain("offline");
    await act(async () => {
      tree.root.findByProps({ accessibilityRole: "button" }).props.onPress();
    });
    await settle();
    expect(mockOpenChatConnection).toHaveBeenCalledTimes(2);
    expect(mockScreens.length).toBeGreaterThan(0);
  });
});
