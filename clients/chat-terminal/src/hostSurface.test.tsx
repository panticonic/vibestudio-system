import { describe, expect, it, vi } from "vitest";
import type { PendingApproval } from "@vibestudio/shared/approvals";
import { createSnapshotStore } from "@workspace/snapshot-store";
import type { ApprovalQueue, ApprovalQueueState, ApprovalsClient } from "@workspace/approvals-core";
import { key, type KeyEvent } from "@workspace/terminal-chat";
import { HostSurface, SURFACE_KEY_LABEL, navKeyOf, type SurfacePorts } from "./hostSurface.js";

const ctrlG: KeyEvent = key("char", { ctrl: true, text: "g" });
const char = (text: string): KeyEvent => key("char", { text });

const capability = (id: string): PendingApproval =>
  ({
    kind: "capability",
    approvalId: id,
    title: "Read a file",
    callerId: "panel:x",
    callerKind: "panel",
    // Only what the surface touches; the overlay is not rendered in these tests.
  }) as unknown as PendingApproval;

function setup(options: { update?: boolean } = {}) {
  const queueStore = createSnapshotStore<ApprovalQueueState>({ status: "ready", pending: [] });
  const queue: ApprovalQueue = {
    getSnapshot: queueStore.getSnapshot,
    subscribe: queueStore.subscribe,
    start: vi.fn(async () => {}),
    refresh: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
  };
  const resolve = vi.fn(async (_approvalId: string, ..._decision: unknown[]) => {});
  const approvals = { resolve } as unknown as ApprovalsClient;
  const restarts: string[] = [];
  let update = options.update
    ? { clientId: "chat", source: "clients/chat-terminal", runtime: "terminal" as const, buildKey: "b2", toVersion: "2", fromVersion: null, canRollback: false }
    : null;
  const ports: SurfacePorts = {
    queue,
    approvals,
    pendingUpdate: () => update,
    restartAtSafePoint: () => restarts.push("restart"),
    report: vi.fn(),
  };
  const surface = new HostSurface(ports);
  return {
    surface,
    resolve,
    restarts,
    ports,
    setPending: (pending: PendingApproval[]) =>
      queueStore.set({ status: "ready", pending }),
    setUpdate: (next: typeof update) => {
      update = next;
      surface.updateChanged();
    },
  };
}

describe("HostSurface", () => {
  it("lets the chat see every key while closed and announces what waits without capturing keys", async () => {
    const t = setup();
    await t.surface.start();
    expect(t.surface.handleInput(char("a"))).toBe(false);
    expect(t.surface.handleInput(ctrlG)).toBe(false);
    t.setPending([capability("a1"), capability("a2")]);
    expect(t.surface.getSnapshot().attention).toBe(`2 approvals waiting — ${SURFACE_KEY_LABEL} answers`);
    expect(t.surface.getSnapshot().view).toBeNull();
    expect(t.surface.handleInput(char("1"))).toBe(false);
    expect(t.resolve).not.toHaveBeenCalled();
  });

  it("opens on Ctrl-G, owns the keyboard, decides with a digit, and gives it back when the queue is empty", async () => {
    const t = setup();
    await t.surface.start();
    t.setPending([capability("a1")]);
    expect(t.surface.handleInput(ctrlG)).toBe(true);
    expect(t.surface.getSnapshot().view).not.toBeNull();
    expect(t.surface.handleInput(char("x"))).toBe(true);
    expect(t.resolve).not.toHaveBeenCalled();
    expect(t.surface.handleInput(char("1"))).toBe(true);
    await vi.waitFor(() => expect(t.resolve).toHaveBeenCalledTimes(1));
    expect(t.resolve.mock.calls[0]![0]).toBe("a1");
    t.setPending([]);
    expect(t.surface.getSnapshot().view).toBeNull();
    expect(t.surface.handleInput(char("1"))).toBe(false);
  });

  it("Escape closes it without deciding and focus reports always reach the chat", async () => {
    const t = setup();
    await t.surface.start();
    t.setPending([capability("a1")]);
    t.surface.handleInput(ctrlG);
    expect(t.surface.handleInput({ type: "focus", focused: false })).toBe(false);
    expect(t.surface.handleInput(key("escape"))).toBe(true);
    expect(t.surface.getSnapshot().view).toBeNull();
    expect(t.resolve).not.toHaveBeenCalled();
  });

  it("reports a decision that was not recorded and refreshes the authoritative queue", async () => {
    const t = setup();
    await t.surface.start();
    t.resolve.mockRejectedValueOnce(new Error("gone"));
    t.setPending([capability("a1")]);
    t.surface.handleInput(ctrlG);
    t.surface.handleInput(char("1"));
    await vi.waitFor(() => expect(t.ports.report).toHaveBeenCalled());
    expect(t.ports.report).toHaveBeenCalledWith("Your decision was not recorded", expect.any(Error));
    expect(t.ports.queue.refresh).toHaveBeenCalled();
  });

  it("offers an update prompt on the same key and restarts only when the person says so", async () => {
    const t = setup({ update: true });
    await t.surface.start();
    expect(t.surface.getSnapshot().attention).toContain("update is ready");
    t.surface.handleInput(ctrlG);
    expect(t.surface.getSnapshot().view).not.toBeNull();
    t.surface.handleInput(char("l"));
    expect(t.restarts).toEqual([]);
    expect(t.surface.getSnapshot().view).toBeNull();
    t.surface.handleInput(ctrlG);
    t.surface.handleInput(char("r"));
    expect(t.restarts).toEqual(["restart"]);
    expect(t.surface.getSnapshot().view).toBeNull();
  });

  it("joins decisions in flight when disposed", async () => {
    const t = setup();
    await t.surface.start();
    let release!: () => void;
    t.resolve.mockImplementationOnce(() => new Promise<void>((r) => (release = r)));
    t.setPending([capability("a1")]);
    t.surface.handleInput(ctrlG);
    t.surface.handleInput(char("1"));
    let disposed = false;
    const done = t.surface.dispose().then(() => (disposed = true));
    await Promise.resolve();
    expect(disposed).toBe(false);
    release();
    await done;
    expect(t.ports.queue.stop).toHaveBeenCalled();
  });
});

describe("navKeyOf", () => {
  it("maps chat keys onto the approval navigation vocabulary", () => {
    expect(navKeyOf(key("up"))).toBe("up");
    expect(navKeyOf(char("3"))).toEqual({ digit: 3 });
    expect(navKeyOf(char("o"))).toEqual({ char: "o" });
    expect(navKeyOf(key("char", { ctrl: true, text: "n" }))).toBe("down");
    expect(navKeyOf(key("f1"))).toBeNull();
  });
});
