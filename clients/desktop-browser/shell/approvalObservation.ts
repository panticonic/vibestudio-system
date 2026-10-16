import type { ApprovalsClient } from "@workspace/approvals-core";
import { SHELL_APPROVAL_PENDING_CHANGED_EVENT } from "@vibestudio/shell-core/approvalState";
import { observeDurableProjection } from "@vibestudio/shell-core/durableObservation";
import type { EventsClient } from "@vibestudio/service-schemas/clients/eventsClient";

export type ApprovalEvents = Pick<EventsClient, "on" | "subscribe" | "unsubscribe">;

/**
 * The watched pending queue over this window's own events client.
 *
 * `createApprovalsClient` observes through a fresh events client on the same
 * RPC, but the desktop's shell session already owns one `desktopEvents` watch
 * that every other surface shares; a second watch on it would replace the
 * first. So the desktop supplies its owned events client and takes everything
 * else from the core.
 */
export function observePendingApprovals(input: {
  list: ApprovalsClient["list"];
  events: ApprovalEvents;
}): ApprovalsClient["observe"] {
  const { list, events } = input;
  return (changed, error) =>
    observeDurableProjection({
      listen: (invalidate) => events.on(SHELL_APPROVAL_PENDING_CHANGED_EVENT, invalidate),
      admit: () => events.subscribe(SHELL_APPROVAL_PENDING_CHANGED_EVENT),
      leave: () => events.unsubscribe(SHELL_APPROVAL_PENDING_CHANGED_EVENT),
      read: list,
      apply: changed,
      error,
    });
}
