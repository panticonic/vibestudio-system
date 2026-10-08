import { isRpcConnectionLost } from "@vibestudio/rpc";
/**
 * useShellEvent - React hook for subscribing to shell events.
 *
 * Automatically subscribes when mounted and unsubscribes when unmounted.
 * Events are emitted via RPC from the main process.
 *
 * Reference-counted: many components can listen to the same event. The one
 * response-owned watch is replaced only when the complete desired topic set
 * changes, and its cancellation is the unsubscribe operation.
 */

import { useEffect, useLayoutEffect, useRef } from "react";
import type {
  EventName,
  EventPayloads,
  ShellWorkspaceClient,
} from "./workspaceClient";
import { useShellWorkspaceClient } from "./workspaceContext";

// Re-export for consumers
export type { EventPayloads } from "./client.js";

/** Refcount per event name. Shared across all hook instances. */
type Subscription = { count: number; ready: Promise<void> };
const references = new WeakMap<
  ShellWorkspaceClient["events"],
  Map<EventName, Subscription>
>();
function subscriptionsFor(events: ShellWorkspaceClient["events"]) {
  let refs = references.get(events);
  if (!refs) {
    refs = new Map();
    references.set(events, refs);
  }
  return refs;
}

function addSubscription(
  events: ShellWorkspaceClient["events"],
  event: EventName,
): Promise<void> {
  const refs = subscriptionsFor(events);
  const existing = refs.get(event);
  if (existing) {
    existing.count += 1;
    return existing.ready;
  }
  const ready = events.subscribe(event);
  refs.set(event, { count: 1, ready });
  return ready;
}

function removeSubscription(
  events: ShellWorkspaceClient["events"],
  event: EventName,
): void {
  const subscriptionRefcounts = subscriptionsFor(events);
  const subscription = subscriptionRefcounts.get(event);
  if (!subscription) return;
  if (subscription.count === 1) {
    subscriptionRefcounts.delete(event);
    void events.unsubscribe(event).catch((err: unknown) => {
      if (!isRpcConnectionLost(err))
        console.warn(`[useShellEvent] unsubscribe ${event} failed:`, err);
    });
  } else {
    subscription.count -= 1;
  }
}

/**
 * Subscribe to a shell event from the main process.
 *
 * @param event - The event name to subscribe to
 * @param callback - Function to call when the event is received
 *
 * @example
 * ```tsx
 * useShellEvent("system-theme-changed", (theme) => {
 *   console.log("Theme changed to:", theme);
 * });
 * ```
 */
export function useShellEvent<E extends EventName>(
  event: E,
  callback: (data: EventPayloads[E]) => void,
  readSnapshot?: (signal: AbortSignal) => void | Promise<void>,
): void {
  const { events } = useShellWorkspaceClient();
  // Use ref to store the latest callback without triggering effect re-runs
  const callbackRef = useRef(callback);

  // Keep an already-installed listener aligned with this commit. A passive
  // effect leaves a window where it can dispatch to the previous render.
  useLayoutEffect(() => {
    callbackRef.current = callback;
  });

  useEffect(() => {
    const cleanup = events.on(event, (payload) => callbackRef.current(payload));
    const lifetime = new AbortController();
    // Read only after the watch is installed. Revisions at the consumer then
    // close the event/query race, including updates during watch opening.
    void addSubscription(events, event)
      .then(() => {
        if (!lifetime.signal.aborted) return readSnapshot?.(lifetime.signal);
      })
      .catch((error: unknown) => {
        if (!lifetime.signal.aborted && !isRpcConnectionLost(error))
          console.warn(`[useShellEvent] watch ${event} failed:`, error);
      });

    return () => {
      lifetime.abort();
      cleanup();
      removeSubscription(events, event);
    };
  }, [events, event, readSnapshot]);
}
