import { useEffect } from "react";

type ShellCompositorBridge = {
  setShellOverlayActive(active: boolean): void;
};

function compositorBridge(): ShellCompositorBridge {
  const bridge = (
    globalThis as typeof globalThis & {
      __vibestudioApp?: ShellCompositorBridge;
    }
  ).__vibestudioApp;
  if (!bridge)
    throw new Error("Desktop shell compositor bridge is unavailable");
  return bridge;
}

/** Keep native panels below shell dialogs without depending on the server. */
export function useSyncShellOverlay(active: boolean): void {
  useEffect(() => {
    // Electron preserves IPC send order from one renderer. Unlike the former
    // workspace RPC, this remains available throughout a server outage.
    compositorBridge().setShellOverlayActive(active);
  }, [active]);
}
