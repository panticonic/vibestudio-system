import { createContext, useContext, type ReactNode } from "react";

/**
 * The palette a native client kit draws with. The hosting client owns the
 * scheme and the values (light, dark, its own brand); the kit only reads them.
 *
 * The palette is layered: `background` is the app canvas, `surface` sits on
 * top of it (bars, cards), `surfaceRaised` on top of that (sheets, menus,
 * toasts), and `surfaceSunken` recedes below (inputs, wells). Text has three
 * tiers; borders two. Metric tokens (spacing/type/radius) live in `./tokens`.
 */
export interface ThemeColors {
  background: string;
  surface: string;
  /** Sheets, menus, toasts -- anything floating above surface. */
  surfaceRaised: string;
  /** Inputs, wells, inactive pills -- recedes below surface. */
  surfaceSunken: string;
  text: string;
  textSecondary: string;
  /** Faint metadata -- counts, timestamps, placeholder glyphs. */
  textTertiary: string;
  border: string;
  /** Softer divider for internal separators. */
  borderSubtle: string;
  primary: string;
  /** Text/icon color rendered on top of a `primary` fill. */
  onPrimary: string;
  accent: string;
  accentSoft: string;
  success: string;
  successSoft: string;
  warning: string;
  warningSoft: string;
  danger: string;
  dangerSoft: string;
  info: string;
  infoSoft: string;
  codeBackground: string;
  /** Scrim behind sheets and dialogs. */
  overlay: string;
  /** Pass to shadowColor together with the `shadow` presets. */
  shadow: string;
  statusConnected: string;
  statusConnecting: string;
  statusDisconnected: string;
}

/** What the hosting client supplies to every kit component beneath it. */
export interface KitEnvironment {
  colors: ThemeColors;
  /**
   * Origin of the server whose units are shown, to resolve a unit's own icon
   * (`MobileUnitIcon`). Empty when no server is connected: icons fall back to
   * their kind's glyph.
   */
  serverUrl: string;
}

const KitEnvironmentContext = createContext<KitEnvironment | null>(null);

export function KitProvider({
  colors,
  serverUrl,
  children,
}: KitEnvironment & { children: ReactNode }) {
  return (
    <KitEnvironmentContext.Provider value={{ colors, serverUrl }}>
      {children}
    </KitEnvironmentContext.Provider>
  );
}

function useKitEnvironment(): KitEnvironment {
  const environment = useContext(KitEnvironmentContext);
  if (!environment) {
    throw new Error("Client kit components must render inside a <KitProvider>.");
  }
  return environment;
}

export const useKitColors = (): ThemeColors => useKitEnvironment().colors;
export const useKitServerUrl = (): string => useKitEnvironment().serverUrl;
