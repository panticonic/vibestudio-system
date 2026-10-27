import { useEffect, useMemo, useRef } from "react";
import {
  buildClientMenu,
  keyPlatformOfBrowser,
  runMenuAction,
  type MenuModel,
} from "./clientMenu";

interface MenuBridge {
  set(model: MenuModel): Promise<void>;
  onAction(handler: (actionId: string) => void): () => void;
}
interface PanelHostBridge {
  run(action: string): Promise<void>;
}
type ClientBridge = { menu?: MenuBridge; panelHost?: PanelHostBridge };

/**
 * Contribute this client's menus to the host (`native-menus`) and perform the
 * entries the host relays back. A host that does not grant `native-menus`
 * rejects the contribution; the client then simply has no native menu, and its
 * in-window controls remain.
 */
export function useClientMenu(deps: {
  panelCommandsEnabled?: boolean;
  clearBuildCache(): Promise<void>;
  failed(action: string, error: unknown): void;
}): void {
  const { clearBuildCache, failed, panelCommandsEnabled = true } = deps;
  const platform = keyPlatformOfBrowser(globalThis.navigator?.userAgent ?? "");
  const model = useMemo(
    () => buildClientMenu(platform, { panelCommandsEnabled }),
    [platform, panelCommandsEnabled],
  );
  const currentModel = useRef(model);
  currentModel.current = model;
  useEffect(() => {
    const bridge = (globalThis as { __vibestudioClient?: ClientBridge })
      .__vibestudioClient;
    const menu = bridge?.menu;
    if (!menu) return;
    menu.set(model).catch((error: unknown) => {
      console.warn(
        "[client-menu] the host did not take this client's menu:",
        error,
      );
    });
    return menu.onAction((actionId) =>
      runMenuAction(actionId, {
        menu: currentModel.current,
        panelHost: (action) => {
          if (!bridge.panelHost)
            return Promise.reject(new Error("This host has no panel host"));
          return bridge.panelHost.run(action);
        },
        clearBuildCache,
        failed,
      }),
    );
  }, [clearBuildCache, failed, model]);
}
