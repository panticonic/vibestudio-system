import { NativeModules } from "react-native";

/**
 * The native module a panel-hosting client instance gets from its host: the
 * durable panel-asset store and per-workspace cookie clearing. The host
 * registers it in an instance only when `panel-hosting` is granted; it is
 * panel-hosting machinery, not a device capability.
 */
export const PANEL_HOST_MODULE = "VibestudioPanelHost";

export function panelHostModule<T>(): T {
  const host = NativeModules[PANEL_HOST_MODULE] as T | undefined;
  if (!host) {
    throw new Error(
      `${PANEL_HOST_MODULE} is unavailable: this client instance does not hold the panel-hosting capability`,
    );
  }
  return host;
}
