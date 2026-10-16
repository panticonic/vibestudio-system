import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RpcClient } from "@vibestudio/rpc";

// A plain function behind the mock: a rejection returned from a `vi.fn` is reported as unhandled.
const listing = vi.hoisted(() => {
  const state = {
    impl: (async () => []) as (...args: unknown[]) => Promise<unknown>,
    calls: 0,
  };
  return state;
});
vi.mock("@workspace/agentic-core/chat-store", () => ({
  listChannelConversations: (...args: unknown[]) => {
    listing.calls += 1;
    return listing.impl(...args);
  },
}));

import { resolveTarget } from "./conversations";

function fakeRpc() {
  const call = vi.fn(async () => ({ contextId: "ctx-new" }));
  return { rpc: { call } as unknown as RpcClient, call };
}

function fakeState(initial: Record<string, unknown> = {}) {
  let stored = initial;
  return {
    get: vi.fn(async () => stored),
    set: vi.fn(async (value: Record<string, unknown>) => {
      stored = value;
    }),
  };
}

const channels = [
  { channelId: "newest", contextId: "ctx-newest", createdAt: 2, current: false, title: "Newest" },
  { channelId: "older", contextId: "ctx-older", createdAt: 1, current: false, title: "Older" },
];

describe("resolveTarget", () => {
  beforeEach(() => {
    listing.calls = 0;
  });

  it("resumes the newest conversation in its own context", async () => {
    listing.impl = async () => channels;
    const { rpc, call } = fakeRpc();
    await expect(resolveTarget(rpc, { kind: "latest" }, fakeState())).resolves.toEqual({
      channelName: "newest",
      contextId: "ctx-newest",
    });
    expect(call).not.toHaveBeenCalled();
  });

  it("starts a new chat in the home context, made once, when there is no conversation yet", async () => {
    listing.impl = async () => [];
    const { rpc, call } = fakeRpc();
    await expect(resolveTarget(rpc, { kind: "latest" }, fakeState())).resolves.toEqual({
      channelName: null,
      contextId: "ctx-new",
    });
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("runs a new chat in the home context and keeps its seed", async () => {
    const { rpc, call } = fakeRpc();
    const options = { agentConfig: {} };
    await expect(resolveTarget(rpc, { kind: "new", options }, fakeState())).resolves.toEqual({
      channelName: null,
      contextId: "ctx-new",
      options,
    });
    expect(call).toHaveBeenCalledTimes(1);
    expect(listing.calls).toBe(0);
  });

  it("finds the context of a conversation an intent named", async () => {
    listing.impl = async () => channels;
    const { rpc } = fakeRpc();
    await expect(
      resolveTarget(rpc, { kind: "conversation", channelName: "older" }, fakeState())
    ).resolves.toEqual({ channelName: "older", contextId: "ctx-older" });
  });

  it("trusts the context a fork names without listing", async () => {
    const { rpc } = fakeRpc();
    await expect(
      resolveTarget(rpc, { kind: "conversation", channelName: "fork", contextId: "ctx-fork" }, fakeState())
    ).resolves.toEqual({ channelName: "fork", contextId: "ctx-fork" });
    expect(listing.calls).toBe(0);
  });

  it("says so when a named conversation does not exist, and propagates listing failures", async () => {
    listing.impl = async () => channels;
    const { rpc } = fakeRpc();
    await expect(resolveTarget(rpc, { kind: "conversation", channelName: "gone" }, fakeState())).rejects.toThrow(
      'The conversation "gone" was not found.'
    );
    const failure = new Error("offline");
    listing.impl = async () => {
      throw failure;
    };
    const outcome = await resolveTarget(rpc, { kind: "latest" }, fakeState()).then(
      () => null,
      (error: unknown) => error
    );
    expect(outcome).toBe(failure);
  });

  it("remembers the home context across launches instead of creating one each time", async () => {
    listing.impl = async () => [];
    const { rpc, call } = fakeRpc();
    const state = fakeState({ keep: "me" });
    const first = await resolveTarget(rpc, { kind: "new" }, state);
    const second = await resolveTarget(rpc, { kind: "new" }, state);
    expect(first.contextId).toBe("ctx-new");
    expect(second.contextId).toBe("ctx-new");
    expect(call).toHaveBeenCalledTimes(1);
    await expect(state.get()).resolves.toEqual({ keep: "me", homeContextId: "ctx-new" });
  });

  it("uses a home context a previous launch stored", async () => {
    const { rpc, call } = fakeRpc();
    await expect(
      resolveTarget(rpc, { kind: "new" }, fakeState({ homeContextId: "ctx-home" }))
    ).resolves.toEqual({ channelName: null, contextId: "ctx-home" });
    expect(call).not.toHaveBeenCalled();
  });
});
