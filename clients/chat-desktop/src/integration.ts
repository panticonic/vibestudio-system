import { useCallback, useEffect, useState } from "react";
import type { ClientBridge } from "./hostBridge";
import type { LauncherOffer } from "./chatMenu";

/** The chord that opens the compact ask window, running the `ask` background intent. */
export const ASK_SHORTCUT = {
  id: "ask",
  accelerator: "CmdOrCtrl+Shift+Space",
  intent: "ask",
} as const;

/** The client id the host gave this window's principal (`client:<id>:web:<device>`). */
export function clientIdOf(runtimeId: string): string {
  const id = runtimeId.split(":")[1];
  if (!id) throw new Error(`Not a client principal: ${runtimeId}`);
  return id;
}

/**
 * Chat's OS integration, each part optional: the ask shortcut (`global-shortcut`)
 * and adding or removing its launcher (`integration.install`). A host that did not
 * grant a capability rejects the call; the window then simply has no such entry.
 * `onFailure` tells the person about a refusal that is theirs to act on (a chord
 * another application holds).
 */
export function useChatIntegration(
  bridge: Pick<ClientBridge, "shortcut" | "integration">,
  clientId: string,
  onFailure: (message: string) => void
): { launcher: LauncherOffer; toggleLauncher(): void } {
  const { shortcut, integration } = bridge;
  const [installed, setInstalled] = useState<boolean | null>(null);

  useEffect(() => {
    if (!shortcut) return;
    let registered = false;
    shortcut.register({ ...ASK_SHORTCUT }).then(
      () => {
        registered = true;
      },
      (error: unknown) => {
        console.warn("[chat] no ask shortcut:", error);
      }
    );
    return () => {
      if (registered) {
        shortcut.unregister(ASK_SHORTCUT.id).catch((error: unknown) => {
          console.warn("[chat] could not release the ask shortcut:", error);
        });
      }
    };
  }, [shortcut]);

  useEffect(() => {
    if (!integration) return;
    let live = true;
    integration.installed().then(
      (ids) => {
        if (live) setInstalled(ids.includes(clientId));
      },
      (error: unknown) => {
        console.warn("[chat] launchers are unavailable:", error);
      }
    );
    return () => {
      live = false;
    };
  }, [integration, clientId]);

  const toggleLauncher = useCallback(() => {
    if (!integration || installed === null) return;
    const change = installed
      ? integration.remove(clientId).then(() => false)
      : integration.install(clientId).then((result) => result.installed);
    change.then(setInstalled, (error: unknown) => {
      onFailure(error instanceof Error ? error.message : String(error));
    });
  }, [integration, installed, clientId, onFailure]);

  return {
    launcher: integration && installed !== null ? (installed ? "remove" : "install") : null,
    toggleLauncher,
  };
}
