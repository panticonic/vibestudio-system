import type { ClientIntent } from "@vibestudio/rn-client-api";

/**
 * What the chat screen shows because of how the client was entered. A new
 * `generation` rebuilds the conversation even when the channel is the same
 * (opening a conversation again, a second share).
 */
export interface ChatLaunch {
  generation: number;
  /** The conversation to open; null starts a new chat. */
  channelName: string | null;
  /** Text to place in the composer of this launch's conversation. */
  initialInput: string | null;
}

/** Entering the client with no intent resumes the conversation the person last had open. */
export function initialLaunch(intent: ClientIntent | null, lastConversation: string | null): ChatLaunch {
  return applyIntent({ generation: 0, channelName: lastConversation, initialInput: null }, intent);
}

/**
 * The launch state after an intent arrives. `open-conversation` opens its
 * conversation, `share` starts a new chat with the shared text in its composer, and every
 * other intent (the implicit `open`) only brings the client forward.
 */
export function applyIntent(current: ChatLaunch, intent: ClientIntent | null): ChatLaunch {
  if (!intent) return current;
  switch (intent.name) {
    case "open-conversation": {
      const conversation = intent.params["conversation"];
      if (!conversation) return current;
      return { generation: current.generation + 1, channelName: conversation, initialInput: null };
    }
    case "share": {
      const text = intent.params["text"];
      if (!text) return current;
      return { generation: current.generation + 1, channelName: null, initialInput: text };
    }
    default:
      return current;
  }
}
