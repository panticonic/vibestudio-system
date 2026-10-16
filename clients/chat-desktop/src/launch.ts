import type { NewConversationOptions } from "@workspace/agentic-core";
import type { ClientIntentEvent } from "./hostBridge";

/** Which conversation the window should show. */
export type ConversationTarget =
  /** The most recent conversation, or a new one when there is none. */
  | { kind: "latest" }
  /** A new conversation, optionally seeded (an agent starting a follow-up chat). */
  | { kind: "new"; options?: NewConversationOptions }
  /** An existing conversation; a fork names its own context, others are looked up. */
  | { kind: "conversation"; channelName: string; contextId?: string };

/**
 * What the window shows because of how it was entered. A new `generation`
 * rebuilds the conversation even when the target is the same one (opening it
 * again from a launcher, starting a second new chat).
 */
export interface Launch {
  generation: number;
  target: ConversationTarget;
}

export const INITIAL_LAUNCH: Launch = { generation: 0, target: { kind: "latest" } };

export function openConversation(current: Launch, target: ConversationTarget): Launch {
  return { generation: current.generation + 1, target };
}

/**
 * The launch after a foreground intent arrives. `open-conversation` shows the
 * conversation it names; every other intent (the implicit `open`) only brings
 * the window forward, which the host does before the client hears of it.
 */
export function applyIntent(current: Launch, intent: ClientIntentEvent): Launch {
  if (intent.name !== "open-conversation") return current;
  const channelName = intent.params["conversation"];
  if (!channelName) return current;
  return openConversation(current, { kind: "conversation", channelName });
}
