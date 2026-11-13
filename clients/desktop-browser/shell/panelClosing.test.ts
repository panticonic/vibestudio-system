import { describe, expect, it, vi } from "vitest";
import { createPanelClosing } from "./panelClosing";

function closedEntry(slotId: string, title: string, closedCount = 1) {
  return {
    slotId,
    parentSlotId: null,
    closedAt: 1,
    closedCount,
    entityId: `entity-${slotId}`,
    source: `panels/${slotId}`,
    title,
  };
}

function harness() {
  let closes: ReturnType<typeof closedEntry>[] = [];
  const archive = vi.fn(async (_id: string) => undefined);
  const focus = vi.fn(async () => undefined);
  const panelTree = {
    get: vi.fn((id: string) => ({
      archive: async () => {
        await archive(id);
        closes = [
          closedEntry(id, `Title ${id}`, id === "parent" ? 3 : 1),
          ...closes,
        ];
      },
    })),
    closed: vi.fn(async (input?: { limit?: number }) =>
      closes.slice(0, input?.limit ?? closes.length),
    ),
    reopen: vi.fn(async (id: string) => {
      closes = closes.filter((entry) => entry.slotId !== id);
      return { id, focus };
    }),
  };
  let issued = 0;
  const notification = {
    show: vi.fn(async () => `notice-${++issued}`),
    dismiss: vi.fn(async (_id: string) => undefined),
  };
  const closing = createPanelClosing({
    panelTree: panelTree as never,
    notification,
  });
  return { closing, panelTree, notification, archive, focus };
}

describe("panel closing", () => {
  it("closes a panel and offers one persistent undo for exactly that close", async () => {
    const { closing, notification, archive } = harness();
    await closing.close("parent");
    expect(archive).toHaveBeenCalledWith("parent");
    expect(notification.show).toHaveBeenCalledExactlyOnceWith({
      type: "info",
      title: "Closed “Title parent”",
      message: "With 2 sub-panels.",
      ttl: 0,
      actions: [{ id: "undo", label: "Undo", variant: "solid" }],
    });
  });

  it("replaces the previous notice when another panel closes", async () => {
    const { closing, notification } = harness();
    await closing.close("a");
    await closing.close("b");
    expect(notification.dismiss).toHaveBeenCalledExactlyOnceWith("notice-1");
    // The superseded notice no longer reopens anything.
    closing.handleNotificationAction({ id: "notice-1", actionId: "undo" });
    await Promise.resolve();
    expect(notification.show).toHaveBeenCalledTimes(2);
  });

  it("reopens and presents the close its Undo names, then forgets the notice", async () => {
    const { closing, panelTree, focus, notification } = harness();
    await closing.close("a");
    closing.handleNotificationAction({ id: "notice-1", actionId: "undo" });
    await vi.waitFor(() => expect(focus).toHaveBeenCalledOnce());
    expect(panelTree.reopen).toHaveBeenCalledExactlyOnceWith("a");
    // Acting on it retired it host-side; there is nothing left to dismiss.
    expect(notification.dismiss).not.toHaveBeenCalled();
    closing.handleNotificationAction({ id: "notice-1", actionId: "undo" });
    await Promise.resolve();
    expect(panelTree.reopen).toHaveBeenCalledOnce();
  });

  it("does nothing on dismissal but forget the notice", async () => {
    const { closing, panelTree } = harness();
    await closing.close("a");
    closing.handleNotificationAction({ id: "notice-1", actionId: "dismiss" });
    closing.handleNotificationAction({ id: "notice-1", actionId: "undo" });
    await Promise.resolve();
    expect(panelTree.reopen).not.toHaveBeenCalled();
  });

  it("retires the notice when its close is reopened another way", async () => {
    const { closing, notification, focus } = harness();
    await closing.close("a");
    await expect(closing.reopenLastClosed()).resolves.toMatchObject({
      id: "a",
    });
    expect(focus).toHaveBeenCalledOnce();
    expect(notification.dismiss).toHaveBeenCalledExactlyOnceWith("notice-1");
  });

  it("reopens nothing when nothing is closed", async () => {
    const { closing, panelTree } = harness();
    await expect(closing.reopenLastClosed()).resolves.toBeNull();
    expect(panelTree.reopen).not.toHaveBeenCalled();
  });

  it("reports a failed undo instead of dropping it", async () => {
    const { closing, panelTree, notification } = harness();
    await closing.close("a");
    panelTree.reopen.mockRejectedValueOnce(new Error("parent is closed"));
    closing.handleNotificationAction({ id: "notice-1", actionId: "undo" });
    await vi.waitFor(() =>
      expect(notification.show).toHaveBeenLastCalledWith({
        type: "error",
        title: "Couldn't reopen panel",
        message: expect.any(String),
      }),
    );
  });

  it("propagates a failed close and announces nothing", async () => {
    const { closing, archive, notification } = harness();
    archive.mockRejectedValueOnce(new Error("denied"));
    await expect(closing.close("a")).rejects.toThrow("denied");
    expect(notification.show).not.toHaveBeenCalled();
  });
});
