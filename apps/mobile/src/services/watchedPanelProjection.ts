import type { EventName } from "@vibestudio/shared/events";

/**
 * Events that can change the live panel projection after a durable tree read.
 *
 * The watch must be admitted before the authoritative reconciliation read.
 * Otherwise an activation between those two operations is edge-triggered away
 * and a retained panel can remain permanently projected as pending.
 */
export const MOBILE_PANEL_PROJECTION_EVENTS = [
  "panel:runtimeLeaseChanged",
  "panel-tree-invalidated",
  "panel-presentation-changed",
  "panel:executionActivated",
  "panel:executionFailed",
] as const satisfies readonly EventName[];

export async function reconcileWatchedPanelProjection(input: {
  subscribe(events: readonly EventName[]): Promise<void>;
  revision(): number;
  reconcile(): Promise<void>;
}): Promise<void> {
  await input.subscribe(MOBILE_PANEL_PROJECTION_EVENTS);
  // An event can be applied while an earlier snapshot RPC is still in flight,
  // after which that stale response can overwrite the event. Repeat the
  // authoritative read whenever an admitted event crossed the read. Once a
  // read spans no event, subsequent events apply normally through the watch.
  for (;;) {
    const before = input.revision();
    await input.reconcile();
    if (input.revision() === before) return;
  }
}
