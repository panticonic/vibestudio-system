import { describe, expect, it, vi } from "vitest";
import {
  buildChatMenu,
  conversationAction,
  NEW_CHAT_ACTION,
  runChatMenuAction,
  type ChatMenuActions,
} from "./chatMenu";
import type { ChannelListing } from "./conversations";

const listing = (id: string, title = id): ChannelListing => ({
  channelId: id,
  contextId: `ctx-${id}`,
  createdAt: 0,
  current: false,
  title,
});

function actions(): ChatMenuActions {
  return { newChat: vi.fn(), openConversation: vi.fn(), failed: vi.fn() };
}

describe("chat menu", () => {
  it("offers New Chat and the newest conversations, in the menu bar and the popup", () => {
    const model = buildChatMenu([listing("a", "Alpha"), listing("b")]);
    expect(model.menus).toEqual([
      {
        label: "Chat",
        items: [
          { id: NEW_CHAT_ACTION, label: "New Chat", accelerator: "CmdOrCtrl+N" },
          {
            label: "Conversations",
            submenu: [
              { id: conversationAction("a"), label: "Alpha" },
              { id: conversationAction("b"), label: "b" },
            ],
          },
        ],
      },
    ]);
    expect(model.popup).toEqual(model.menus[0]!.items);
  });

  it("omits the conversations submenu while there are none, and bounds a long list", () => {
    expect(buildChatMenu([]).menus[0]!.items).toHaveLength(1);
    const many = Array.from({ length: 40 }, (_, index) => listing(`c${index}`));
    const submenu = buildChatMenu(many).menus[0]!.items[1]!.submenu!;
    expect(submenu).toHaveLength(12);
    expect(submenu[0]!.id).toBe(conversationAction("c0"));
  });

  it("performs its own entries and reports any other", () => {
    const run = actions();
    runChatMenuAction(NEW_CHAT_ACTION, run);
    runChatMenuAction(conversationAction("chan:1"), run);
    runChatMenuAction("zoom-in", run);
    expect(run.newChat).toHaveBeenCalledTimes(1);
    expect(run.openConversation).toHaveBeenCalledWith("chan:1");
    expect(run.failed).toHaveBeenCalledWith("zoom-in", expect.any(Error));
  });
});
