import {
  applyChatHostStatePatch,
  type ChatHostState,
  type StateArgsPort,
} from "@workspace/agentic-core/chat-store";

/**
 * One conversation's durable host state. Which channel a window runs is decided
 * by what the person opened (an intent, the list, the newest conversation), so
 * the state lives exactly as long as the conversation's host does; nothing is
 * kept across launches.
 */
export function conversationState(initial: ChatHostState): StateArgsPort {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    async patch(partial) {
      state = applyChatHostStatePatch(state, partial);
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
