// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Theme } from "@radix-ui/themes";
import type { ChatSession } from "./session";

const store = vi.hoisted(() => {
  const state = {
    controllers: [] as Array<{
      ports: any;
      snapshot: any;
      listeners: Set<() => void>;
      retain: ReturnType<typeof vi.fn>;
      released: number;
    }>,
  };
  return state;
});

vi.mock("@workspace/agentic-core/chat-store", () => {
  class ChatHostController {
    readonly entry: (typeof store.controllers)[number];
    readonly actions = { onAddAgent: vi.fn() };
    constructor(ports: unknown) {
      this.entry = {
        ports,
        snapshot: {
          channelName: (ports as any).state.get().channelName ?? null,
          availableAgents: [],
          modelCatalog: null,
          workspaceDefaultModelRef: null,
          effectiveDefaultAgentConfig: null,
          firstAgentModelPreflight: { status: "ready" },
          modelSettingsError: null,
          agentCatalogError: null,
          recovery: { status: "idle", missing: [], attempt: 0, error: null },
          connectionRetrySignal: 0,
        },
        listeners: new Set(),
        retain: vi.fn(),
        released: 0,
      };
      store.controllers.push(this.entry);
    }
    subscribe = (listener: () => void) => {
      this.entry.listeners.add(listener);
      return () => this.entry.listeners.delete(listener);
    };
    getSnapshot = () => this.entry.snapshot;
    retain = () => {
      this.entry.retain();
      return () => void (this.entry.released += 1);
    };
    readForkCursors = vi.fn();
    markForkRead = vi.fn();
    retryModelSettings = vi.fn();
    retryAgentCatalog = vi.fn();
    retryAgentRecovery = vi.fn();
  }
  return {
    ChatHostController,
    chatHostActionData: () => ({}),
    createChatHostPorts: (input: unknown) => input,
  };
});

const chat = vi.hoisted(() => ({ props: [] as any[] }));
vi.mock("@workspace/agentic-chat/chat", () => ({
  AgenticChat: (props: unknown) => {
    chat.props.push(props);
    return <div data-testid="chat" />;
  },
}));

import { ChatPane } from "./ChatPane";

const session = {
  clientId: "client:chat:web:dev-1",
  rpc: { marker: "rpc" },
  events: { marker: "events" },
} as unknown as ChatSession;

function mount(overrides: Partial<React.ComponentProps<typeof ChatPane>> = {}) {
  const props = {
    session,
    conversation: { channelName: "chan-1", contextId: "ctx-1" },
    theme: "light" as const,
    ...overrides,
    onChannel: vi.fn(),
    onOpenConversation: vi.fn(),
    onNewChat: vi.fn(),
  };
  render(
    <Theme>
      <ChatPane {...props} />
    </Theme>
  );
  return props;
}

const lastChat = () => chat.props[chat.props.length - 1];

describe("ChatPane", () => {
  beforeEach(() => {
    store.controllers.length = 0;
    chat.props.length = 0;
  });
  afterEach(cleanup);

  it("runs the conversation over the routed session's host ports, in the conversation's context", async () => {
    const props = mount();
    const [controller] = store.controllers;
    expect(controller!.ports.rpc).toBe(session.rpc);
    expect(controller!.ports.events).toBe(session.events);
    expect(controller!.ports.contextId).toBe("ctx-1");
    expect(controller!.ports.state.get()).toEqual({ channelName: "chan-1" });
    expect(controller!.retain).toHaveBeenCalledTimes(1);

    await screen.findByTestId("chat");
    expect(lastChat()).toMatchObject({
      channelName: "chan-1",
      contextId: "ctx-1",
      config: { clientId: "client:chat:web:dev-1", rpc: session.rpc },
      features: [],
      theme: "light",
      heightMode: "container",
    });
    await waitFor(() => expect(props.onChannel).toHaveBeenCalledWith("chan-1"));
  });

  it("starts a new chat from the context it was given, with its seed, and reports the minted channel", async () => {
    const seed = { kind: "seed" } as never;
    const props = mount({
      conversation: { channelName: null, contextId: "ctx-fresh", options: { seed } },
    });
    expect(screen.getByText("Starting chat…")).toBeTruthy();
    const [controller] = store.controllers;
    expect(controller!.ports.state.get()).toEqual({});

    controller!.snapshot = { ...controller!.snapshot, channelName: "minted" };
    act(() => controller!.listeners.forEach((listener) => listener()));
    await screen.findByTestId("chat");
    expect(lastChat().channelConfig).toEqual({ seed });
    expect(props.onChannel).toHaveBeenCalledWith("minted");
  });

  it("opens forks and other channels in this one window, and new chats through the window", async () => {
    const props = mount();
    await screen.findByTestId("chat");
    const { forkNav, actions } = lastChat();

    await forkNav.switchTo("fork-1", "ctx-fork");
    await forkNav.openInNewPanel("fork-2", "ctx-fork-2");
    await actions.onOpenChannel("other");
    actions.onNewConversation({ agentConfig: {} });
    expect(props.onOpenConversation.mock.calls).toEqual([
      ["fork-1", "ctx-fork"],
      ["fork-2", "ctx-fork-2"],
      ["other"],
    ]);
    expect(props.onNewChat).toHaveBeenCalledWith({ agentConfig: {} });
  });

  it("releases the conversation's live work when it is replaced or closed", async () => {
    mount();
    await screen.findByTestId("chat");
    cleanup();
    expect(store.controllers[0]!.released).toBe(1);
  });

  it("shows the host's failures with a Retry that goes to the controller", async () => {
    mount();
    const [controller] = store.controllers;
    controller!.snapshot = {
      ...controller!.snapshot,
      modelSettingsError: { title: "Models unavailable", message: "Check your connection", detail: null },
    };
    act(() => controller!.listeners.forEach((listener) => listener()));
    expect(await screen.findByText("Models unavailable.")).toBeTruthy();
  });
});
