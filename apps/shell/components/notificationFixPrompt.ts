import type { NotificationPayload } from "@vibestudio/shared/events";

/** Preserve the displayed failure, including collapsed diagnostics, in the chat draft. */
export function notificationFixPrompt(
  notification: NotificationPayload,
): string {
  const { id, type, title, message, sourcePanelId, details, history } =
    notification;
  return [
    "Help me investigate and fix this issue in Vibestudio. Explain the cause, make the appropriate repair, and verify it.",
    "Notification details:",
    JSON.stringify(
      { id, type, title, message, sourcePanelId, details, history },
      null,
      2,
    ),
  ].join("\n\n");
}
