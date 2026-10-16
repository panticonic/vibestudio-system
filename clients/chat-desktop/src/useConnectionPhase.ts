import { useEffect, useState } from "react";
import type { ConnectionBridge } from "./hostBridge";

/**
 * The host's account of the server connection, as `online`, `ended` (the
 * session is over and only a relaunch recovers) or anything else (the transport
 * is reconnecting by itself). The window shows it; the host owns recovery.
 */
export function useConnectionPhase(bridge: ConnectionBridge): string {
  const [phase, setPhase] = useState("online");
  useEffect(() => {
    let live = true;
    let changed = false;
    const stop = bridge.onChange((state) => {
      changed = true;
      if (live) setPhase(state.phase);
    });
    bridge.getCurrent().then(
      (state) => {
        if (live && !changed) setPhase(state.phase);
      },
      (error: unknown) => console.warn("[chat] connection state is unavailable:", error)
    );
    return () => {
      live = false;
      stop();
    };
  }, [bridge]);
  return phase;
}
