import { describe, expect, it } from "vitest";
import { applyIntent, INITIAL_LAUNCH, openConversation } from "./launch";

describe("chat launch", () => {
  it("starts on the latest conversation", () => {
    expect(INITIAL_LAUNCH).toEqual({ generation: 0, target: { kind: "latest" } });
  });

  it("opens the conversation an open-conversation intent names, even over the same one", () => {
    const first = applyIntent(INITIAL_LAUNCH, {
      name: "open-conversation",
      params: { conversation: "chan-2" },
    });
    expect(first).toEqual({ generation: 1, target: { kind: "conversation", channelName: "chan-2" } });
    const again = applyIntent(first, { name: "open-conversation", params: { conversation: "chan-2" } });
    expect(again.generation).toBe(2);
  });

  it("ignores an intent that names nothing to show, and the implicit open", () => {
    expect(applyIntent(INITIAL_LAUNCH, { name: "open-conversation", params: {} })).toBe(INITIAL_LAUNCH);
    expect(applyIntent(INITIAL_LAUNCH, { name: "open", params: {} })).toBe(INITIAL_LAUNCH);
    expect(applyIntent(INITIAL_LAUNCH, { name: "ask", params: { text: "hi" } })).toBe(INITIAL_LAUNCH);
  });

  it("carries a fork's own context and a new chat's seed", () => {
    const fork = openConversation(INITIAL_LAUNCH, {
      kind: "conversation",
      channelName: "fork-1",
      contextId: "ctx-fork",
    });
    expect(fork.target).toEqual({ kind: "conversation", channelName: "fork-1", contextId: "ctx-fork" });
    const fresh = openConversation(fork, { kind: "new", options: { agentConfig: {} } });
    expect(fresh.generation).toBe(2);
    expect(fresh.target).toEqual({ kind: "new", options: { agentConfig: {} } });
  });
});
