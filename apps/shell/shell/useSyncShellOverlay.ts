import { useCallback, useEffect, useRef } from "react";
import { isRpcConnectionLost } from "@vibestudio/rpc";
import { useShellWorkspaceClient } from "./workspaceContext";
import { useShellEvent } from "./useShellEvent";

/** The window owns one ordered writer for native dialog visibility. */
export function useSyncShellOverlay(active: boolean): void {
  const { view } = useShellWorkspaceClient();
  const tail = useRef(Promise.resolve());
  const desired = useRef<{ view: typeof view; active: boolean } | null>(null);
  const sync = useCallback(() => {
    const state = desired.current;
    if (!state) return;
    // Native calls await remote UI admission, so concurrent calls can execute
    // in reverse order. Wait for the previous write and discard superseded
    // queued states; only the latest committed dialog state should follow it.
    tail.current = tail.current
      .then(() => {
        if (desired.current === state)
          return state.view.setShellOverlay(state.active);
      })
      .catch((error: unknown) => {
        if (!isRpcConnectionLost(error)) {
          console.warn("[MainMode] Shell overlay sync failed:", error);
        }
      });
  }, []);

  useEffect(() => {
    desired.current = { view, active };
    sync();
    return () => {
      desired.current = null;
    };
  }, [view, active, sync]);
  useShellEvent(
    "server-connection-changed",
    useCallback(
      ({ status }) => {
        if (status === "connected") sync();
      },
      [sync],
    ),
  );
}
