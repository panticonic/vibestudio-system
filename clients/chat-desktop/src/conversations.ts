import type { RpcClient } from "@vibestudio/rpc";
import type { NewConversationOptions } from "@workspace/agentic-core";
import { mainRpcMethods } from "@vibestudio/service-schemas/mainRpc";
import {
  listChannelConversations,
  type ChannelListing,
} from "@workspace/agentic-core/chat-store";
import type { ClientStateBridge } from "./hostBridge";
import type { ConversationTarget } from "./launch";

/** A conversation to run: a channel (none yet for a new chat) in the context it lives in. */
export interface ConversationRef {
  channelName: string | null;
  contextId: string;
  /** What a new conversation starts with. */
  options?: NewConversationOptions;
}

export type { ChannelListing };

/** The conversations this workspace holds, newest first. */
export function listConversations(
  rpc: RpcClient,
  currentChannel: string | null,
  signal?: AbortSignal
): Promise<ChannelListing[]> {
  return listChannelConversations(rpc, {
    currentChannelId: currentChannel,
    ...(signal ? { signal } : {}),
  });
}

/**
 * The context this client's own chats run in. It is made once and remembered in
 * the host-kept client state, so a relaunch resumes in it instead of minting a
 * new context each time.
 */
async function homeContext(rpc: RpcClient, state: ClientStateBridge): Promise<string> {
  const saved = (await state.get())["homeContextId"];
  if (typeof saved === "string" && saved) return saved;
  const { contextId } = await rpc.call("main", mainRpcMethods["runtime.createContext"], [{}]);
  // Keep every other key the client stored.
  await state.set({ ...(await state.get()), homeContextId: contextId });
  return contextId;
}

/**
 * Turn what the person asked for into a conversation to run. A new chat runs
 * in this client's home context (a conversation's agents work inside it, the
 * same as a chat panel's); the latest conversation is the newest channel the
 * workspace holds.
 */
export async function resolveTarget(
  rpc: RpcClient,
  target: ConversationTarget,
  state: ClientStateBridge
): Promise<ConversationRef> {
  switch (target.kind) {
    case "new":
      return {
        channelName: null,
        contextId: await homeContext(rpc, state),
        ...(target.options ? { options: target.options } : {}),
      };
    case "latest": {
      const [latest] = await listConversations(rpc, null);
      return latest
        ? { channelName: latest.channelId, contextId: latest.contextId }
        : { channelName: null, contextId: await homeContext(rpc, state) };
    }
    case "conversation": {
      if (target.contextId) return { channelName: target.channelName, contextId: target.contextId };
      const found = (await listConversations(rpc, null)).find(
        (listing) => listing.channelId === target.channelName
      );
      if (!found) throw new Error(`The conversation "${target.channelName}" was not found.`);
      return { channelName: found.channelId, contextId: found.contextId };
    }
  }
}
