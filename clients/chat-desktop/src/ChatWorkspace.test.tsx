// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Theme } from "@radix-ui/themes";
import type { ChannelListing, ConversationRef } from "./conversations";
import type { ChatPaneProps } from "./ChatPane";
import type { ChatSession } from "./session";
import { fakeHost } from "./testing";

const conversations = vi.hoisted(() => ({
  listConversations: vi.fn(),
  resolveTarget: vi.fn(),
}));
vi.mock("./conversations", () => conversations);

const pane = vi.hoisted(() => ({ props: [] as unknown[] }));
vi.mock("./ChatPane", () => ({
  ChatPane: (props: ChatPaneProps) => {
    pane.props.push(props);
    return <div data-testid="pane">{props.conversation.channelName ?? "(new)"}</div>;
  },
}));
vi.mock("./ApprovalDock", () => ({ ApprovalDock: () => <div data-testid="dock" /> }));

import { ChatWorkspace } from "./ChatWorkspace";

const listing = (id: string, title: string): ChannelListing => ({
  channelId: id,
  contextId: `ctx-${id}`,
  createdAt: 0,
  current: false,
  title,
});
const channels = [listing("newest", "Newest chat"), listing("older", "Older chat")];

const session = { rpc: { marker: "rpc" }, workspaceId: "personal-ws" } as unknown as ChatSession;

function mount(fake: ReturnType<typeof fakeHost>) {
  return render(
    <Theme>
      <ChatWorkspace host={fake.host} session={session} appearance="light" />
    </Theme>
  );
}

const lastPane = () => pane.props[pane.props.length - 1] as ChatPaneProps;

describe("ChatWorkspace", () => {
  beforeEach(() => {
    pane.props.length = 0;
    conversations.listConversations.mockReset().mockResolvedValue(channels);
    conversations.resolveTarget.mockReset().mockImplementation(
      async (_rpc: unknown, target: { kind: string; channelName?: string }): Promise<ConversationRef> =>
        target.kind === "new"
          ? { channelName: null, contextId: "ctx-fresh" }
          : target.kind === "conversation"
            ? { channelName: target.channelName!, contextId: `ctx-${target.channelName}` }
            : { channelName: "newest", contextId: "ctx-newest" }
    );
  });
  afterEach(cleanup);

  it("shows the newest conversation beside the list of them all, and the approvals dock", async () => {
    const fake = fakeHost();
    mount(fake);
    expect(await screen.findByTestId("pane")).toHaveProperty("textContent", "newest");
    expect(await screen.findByRole("button", { name: "Newest chat" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Older chat" })).toBeTruthy();
    expect(screen.getByTestId("dock")).toBeTruthy();
    expect(conversations.resolveTarget).toHaveBeenCalledWith(
      session.rpc,
      { kind: "latest" },
      fake.state
    );
  });

  it("opens a conversation chosen from the list, and starts a new chat from the sidebar", async () => {
    const fake = fakeHost();
    mount(fake);
    await screen.findByTestId("pane");
    fireEvent.click(await screen.findByRole("button", { name: "Older chat" }));
    await waitFor(() => expect(screen.getByTestId("pane").textContent).toBe("older"));
    expect(conversations.resolveTarget).toHaveBeenLastCalledWith(
      session.rpc,
      { kind: "conversation", channelName: "older", contextId: "ctx-older" },
      fake.state
    );

    fireEvent.click(screen.getByRole("button", { name: /New Chat/ }));
    await waitFor(() => expect(screen.getByTestId("pane").textContent).toBe("(new)"));
  });

  it("follows an open-conversation intent the host relays, and ignores the implicit open", async () => {
    const fake = fakeHost();
    mount(fake);
    await screen.findByTestId("pane");
    expect(fake.intentSubscribers()).toBe(1);

    act(() => fake.intent({ name: "open", params: {} }));
    expect(screen.getByTestId("pane").textContent).toBe("newest");

    act(() => fake.intent({ name: "open-conversation", params: { conversation: "older" } }));
    await waitFor(() => expect(screen.getByTestId("pane").textContent).toBe("older"));
  });

  it("learns the channel a new chat mints, so the sidebar lists it", async () => {
    const fake = fakeHost();
    mount(fake);
    await screen.findByTestId("pane");
    conversations.listConversations.mockClear();
    act(() => lastPane().onChannel("minted"));
    await waitFor(() =>
      expect(conversations.listConversations).toHaveBeenCalledWith(session.rpc, "minted", expect.anything())
    );
  });

  it("opens a fork in place, in the context the fork names", async () => {
    const fake = fakeHost();
    mount(fake);
    await screen.findByTestId("pane");
    act(() => lastPane().onOpenConversation("fork-1", "ctx-fork"));
    await waitFor(() => expect(screen.getByTestId("pane").textContent).toBe("fork-1"));
    expect(conversations.resolveTarget).toHaveBeenLastCalledWith(
      session.rpc,
      { kind: "conversation", channelName: "fork-1", contextId: "ctx-fork" },
      fake.state
    );
  });

  it("contributes the menu and performs the entries the host relays back", async () => {
    const fake = fakeHost();
    mount(fake);
    await screen.findByRole("button", { name: "Older chat" });
    await waitFor(() => {
      const model = fake.menu.set.mock.calls.at(-1)?.[0];
      expect(model?.menus[0]?.items[1]?.submenu).toHaveLength(2);
    });

    act(() => fake.chooseMenu("conversation:older"));
    await waitFor(() => expect(screen.getByTestId("pane").textContent).toBe("older"));
    act(() => fake.chooseMenu("new-chat"));
    await waitFor(() => expect(screen.getByTestId("pane").textContent).toBe("(new)"));
  });

  it("says why a conversation could not be opened and offers Retry", async () => {
    conversations.resolveTarget.mockRejectedValueOnce(new Error("The conversation was not found."));
    const fake = fakeHost();
    mount(fake);
    expect(await screen.findByText("The conversation was not found.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByTestId("pane")).toBeTruthy();
  });

  it("shows the host's connection state without owning recovery", async () => {
    const fake = fakeHost();
    mount(fake);
    await screen.findByTestId("pane");
    act(() => fake.setConnection({ phase: "reconnecting" as never }));
    expect(await screen.findByText(/Reconnecting to your workspace/)).toBeTruthy();
    act(() => fake.setConnection({ phase: "ended" }));
    expect(await screen.findByText(/Relaunch Chat/)).toBeTruthy();
    act(() => fake.setConnection({ phase: "online" }));
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
  });
});
