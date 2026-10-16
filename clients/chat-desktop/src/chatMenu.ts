import { useEffect } from "react";
import type { ClientBridge, MenuItem, MenuModel } from "./hostBridge";
import type { ChannelListing } from "./conversations";

/**
 * This client's native menu (`native-menus`): New Chat and the conversations.
 * The host owns no chat UI; it builds the menu from this data and hands a chosen
 * entry back as its action id.
 */

export const NEW_CHAT_ACTION = "new-chat";
export const TOGGLE_LAUNCHER_ACTION = "toggle-launcher";

/** What the launcher entry offers: add Chat to the OS applications, or take it out again. */
export type LauncherOffer = "install" | "remove" | null;
const CONVERSATION_PREFIX = "conversation:";
/** The menu lists the newest conversations; the sidebar lists them all. */
const MENU_CONVERSATIONS = 12;

export function conversationAction(channelId: string): string {
  return `${CONVERSATION_PREFIX}${channelId}`;
}

export function buildChatMenu(
  conversations: readonly ChannelListing[],
  launcher: LauncherOffer = null
): MenuModel {
  const newChat: MenuItem = { id: NEW_CHAT_ACTION, label: "New Chat", accelerator: "CmdOrCtrl+N" };
  const recent: MenuItem[] = conversations.slice(0, MENU_CONVERSATIONS).map((conversation) => ({
    id: conversationAction(conversation.channelId),
    label: conversation.title.slice(0, 100),
  }));
  const conversationsMenu: MenuItem[] = recent.length
    ? [{ label: "Conversations", submenu: recent }]
    : [];
  const launcherMenu: MenuItem[] = launcher
    ? [
        { separator: true },
        {
          id: TOGGLE_LAUNCHER_ACTION,
          label: launcher === "install" ? "Add Chat to Applications…" : "Remove Chat from Applications",
        },
      ]
    : [];
  return {
    menus: [{ label: "Chat", items: [newChat, ...conversationsMenu, ...launcherMenu] }],
    popup: [newChat, ...conversationsMenu, ...launcherMenu],
  };
}

export interface ChatMenuActions {
  newChat(): void;
  openConversation(channelId: string): void;
  toggleLauncher(): void;
  /** Tell the person a menu entry could not be carried out. */
  failed(action: string, error: unknown): void;
}

/** Perform a chosen menu entry. */
export function runChatMenuAction(actionId: string, actions: ChatMenuActions): void {
  if (actionId === NEW_CHAT_ACTION) {
    actions.newChat();
  } else if (actionId === TOGGLE_LAUNCHER_ACTION) {
    actions.toggleLauncher();
  } else if (actionId.startsWith(CONVERSATION_PREFIX)) {
    actions.openConversation(actionId.slice(CONVERSATION_PREFIX.length));
  } else {
    actions.failed(actionId, new Error(`Unknown menu action: ${actionId}`));
  }
}

/**
 * Contribute the menu while it holds and perform the entries the host relays
 * back. A host that did not grant `native-menus` rejects the contribution; the
 * window then simply has no native menu and its in-window controls remain.
 */
export function useChatMenu(
  bridge: Pick<ClientBridge, "menu">,
  conversations: readonly ChannelListing[],
  actions: ChatMenuActions,
  launcher: LauncherOffer = null
): void {
  const { menu } = bridge;
  useEffect(() => {
    if (!menu) return;
    menu.set(buildChatMenu(conversations, launcher)).catch((error: unknown) => {
      console.warn("[chat-menu] the host did not take this client's menu:", error);
    });
  }, [menu, conversations, launcher]);
  const { newChat, openConversation, toggleLauncher, failed } = actions;
  useEffect(() => {
    if (!menu) return;
    return menu.onAction((actionId) =>
      runChatMenuAction(actionId, { newChat, openConversation, toggleLauncher, failed })
    );
  }, [menu, newChat, openConversation, toggleLauncher, failed]);
}
