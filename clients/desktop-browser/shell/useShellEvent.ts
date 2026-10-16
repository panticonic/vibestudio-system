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
import { observeDurableProjection } from "@vibestudio/shell-core/durableObservation";
import type { EventName, EventPayloads } from "./workspaceClient";
import { useShellWorkspaceClient } from "./workspaceContext";
import { localShellEvents } from "./localShellEvents";

// Re-export for consumers
export type { EventPayloads } from "./client.js";

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
    const lifetime = new AbortController();
    // The same handler also serves events this client raises for itself.
    const releaseLocal = localShellEvents.on(event, (payload) => callbackRef.current(payload));
    const observation = observeDurableProjection({
      listen: (invalidate) =>
        events.on(event, (payload) => {
          callbackRef.current(payload);
          invalidate();
        }),
      admit: () => events.subscribe(event),
      leave: () => events.unsubscribe(event),
      read: async () => {
        if (!lifetime.signal.aborted) await readSnapshot?.(lifetime.signal);
      },
      apply: () => undefined,
      error: (error) => {
        if (!lifetime.signal.aborted && !isRpcConnectionLost(error))
          console.warn(`[useShellEvent] watch ${event} failed:`, error);
      },
    });

    return () => {
      releaseLocal();
      lifetime.abort();
      void observation.stop().catch((error: unknown) => {
        if (!isRpcConnectionLost(error))
          console.warn(`[useShellEvent] retire ${event} failed:`, error);
      });
    };
  }, [events, event, readSnapshot]);
}
