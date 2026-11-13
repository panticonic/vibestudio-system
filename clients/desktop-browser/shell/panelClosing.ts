import type { PanelRuntimeApi } from "@workspace/runtime/panel-runtime";
import type { NotificationPayload } from "@vibestudio/shared/events";
import { userFacingError } from "@workspace/client-kit-web/userFacingError";

type PanelTree = Pick<
  PanelRuntimeApi["panelTree"],
  "get" | "closed" | "reopen"
>;

interface Notifications {
  show(
    opts: Omit<NotificationPayload, "id" | "sourcePanelId" | "iconDataUrl">,
  ): Promise<string>;
  dismiss(id: string): Promise<void>;
}

const UNDO_ACTION_ID = "undo";

/**
 * Closing panels the way a browser closes tabs: a close takes the panel and its
 * descendants out of the tree, and is reversible. A close this client makes
 * leaves one persistent notice with an Undo for exactly that close; the next
 * close replaces it, and reopening that close retires it.
 *
 * The notice is an ordinary caller-owned notification. Its Undo is reported
 * back as the `notification:action` event, which the owner of this object
 * routes to `handleNotificationAction`.
 */
export function createPanelClosing(deps: {
  panelTree: PanelTree;
  notification: Notifications;
}) {
  const { panelTree, notification } = deps;
  /**
   * Undo notices this client shows, by notification id. Normally one: a close
   * retires the notice before it. A notice whose dismissal failed stays here,
   * because it is still on screen and its Undo still names a real close.
   */
  const notices = new Map<string, string>();
  /** Orders notice replacement when the announcements of two closes overlap. */
  let generation = 0;

  const retire = async (id: string) => {
    try {
      await notification.dismiss(id);
      notices.delete(id);
    } catch (error) {
      // The close it announced already happened; a failed dismissal is not
      // that close's failure.
      console.warn("[panelClosing] could not retire undo notice:", error);
    }
  };

  const close = async (panelId: string): Promise<void> => {
    await panelTree.get(panelId).archive();
    // Counted once the close happened: a failed close supersedes nothing.
    const issued = ++generation;
    const entry = (await panelTree.closed()).find(
      (candidate) => candidate.slotId === panelId,
    );
    // Someone reopened it already: there is nothing to undo.
    if (!entry) return;
    const descendants = entry.closedCount - 1;
    const id = await notification.show({
      type: "info",
      title: `Closed “${entry.title}”`,
      ...(descendants > 0
        ? {
            message: `With ${descendants} sub-panel${descendants === 1 ? "" : "s"}.`,
          }
        : {}),
      ttl: 0,
      actions: [{ id: UNDO_ACTION_ID, label: "Undo", variant: "solid" }],
    });
    notices.set(id, panelId);
    // A later close is already being announced: this notice is the stale one.
    const superseded =
      issued === generation
        ? [...notices.keys()].filter((candidate) => candidate !== id)
        : [id];
    await Promise.all(superseded.map(retire));
  };

  const reopen = async (slotId: string) => {
    const handle = await panelTree.reopen(slotId);
    await handle.focus();
    const announcing = [...notices]
      .filter(([, closedSlotId]) => closedSlotId === slotId)
      .map(([id]) => id);
    await Promise.all(announcing.map(retire));
    return handle;
  };

  return {
    close,
    /** Closes that can be reopened now, most recent first. */
    closed: (input?: { limit?: number }) => panelTree.closed(input),
    /** Reopen the close rooted at `slotId` and present it. */
    reopen,
    /** Reopen the most recent close; resolves null when there is none. */
    reopenLastClosed: async () => {
      const [last] = await panelTree.closed({ limit: 1 });
      return last ? reopen(last.slotId) : null;
    },
    /**
     * The person acted on a notification. Only this client's undo notice is
     * ours; once acted on, the host has retired it, so it is forgotten here.
     */
    handleNotificationAction: (payload: { id: string; actionId: string }) => {
      const slotId = notices.get(payload.id);
      if (slotId === undefined) return;
      notices.delete(payload.id);
      if (payload.actionId !== UNDO_ACTION_ID) return;
      void reopen(slotId).catch((error: unknown) =>
        notification
          .show({
            type: "error",
            title: "Couldn't reopen panel",
            message: userFacingError(error),
          })
          .catch((reportError: unknown) =>
            console.error("[panelClosing] reopen failed:", error, reportError),
          ),
      );
    },
  };
}

export type PanelClosing = ReturnType<typeof createPanelClosing>;
