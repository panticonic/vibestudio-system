import type { RnClientApi } from "@vibestudio/rn-client-api";
import { EventsClient } from "@vibestudio/service-schemas/clients/eventsClient";
import {
  applyChatHostStatePatch,
  createChatHostPorts,
  type ChatHostPorts,
  type ChatHostState,
  type StateArgsPort,
} from "@workspace/agentic-core/chat-store";
import type { ChatHostPortsFactory } from "@workspace/agentic-chat-native";
import type { ChatConnection } from "./chatSession";

/** The client-state key holding the conversation the person last had open. */
export const LAST_CONVERSATION_KEY = "chat.lastConversation";

/**
 * One conversation's durable host state. Which channel a host runs is decided
 * by what the person opened (a launch intent, the list, the last conversation),
 * so the state lives as long as the conversation's host and is not keyed into
 * client storage; the one thing worth outliving it, the channel, is reported
 * through `onChannel` for the client to remember.
 */
export function conversationState(
  initial: ChatHostState,
  onChannel: (channelName: string) => void
): StateArgsPort {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    async patch(partial) {
      state = applyChatHostStatePatch(state, partial);
      if (state.channelName) onChannel(state.channelName);
      for (const listener of [...listeners]) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/**
 * The chat host's ports over this client's workspace connection: the device's
 * routed session for calls, connection status and recovery, workspace events
 * over the same session, and a conversation state that reports the open
 * channel so the next launch resumes it.
 */
export function createClientHostPorts(
  chat: Pick<ChatConnection, "workspace">,
  api: Pick<RnClientApi, "state">,
  report: (message: string, error: unknown) => void
): ChatHostPortsFactory {
  const events = new EventsClient(chat.workspace.rpc);
  return (target): ChatHostPorts =>
    createChatHostPorts({
      rpc: chat.workspace.rpc,
      contextId: target.contextId,
      instanceId: target.key,
      state: conversationState(
        target.channelName ? { channelName: target.channelName } : {},
        (channelName) =>
          void api.state
            .set(LAST_CONVERSATION_KEY, channelName)
            .catch((error: unknown) => report("Could not remember the open conversation", error))
      ),
      events,
      notify: (notification) => report(notification.title, notification.message),
    });
}
