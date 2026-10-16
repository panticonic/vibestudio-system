import type { ReactNode } from "react";
import { KitProvider, type ThemeColors } from "../ui/theme";

/** A fixed dark palette for kit tests; the real one belongs to the hosting client. */
export const testColors: ThemeColors = {
  background: "#111419",
  surface: "#171b22",
  surfaceRaised: "#252b36",
  surfaceSunken: "#111419",
  text: "#eef1f6",
  textSecondary: "#b1bbcb",
  textTertiary: "#b1bbcb",
  border: "#434d5f",
  borderSubtle: "#252b36",
  primary: "#3d6ff0",
  onPrimary: "#ffffff",
  accent: "#9dbaff",
  accentSoft: "#172850",
  success: "#57c785",
  successSoft: "rgba(87, 199, 133, 0.14)",
  warning: "#f7b955",
  warningSoft: "rgba(247, 185, 85, 0.14)",
  danger: "#ff7b72",
  dangerSoft: "rgba(255, 123, 114, 0.14)",
  info: "#9dbaff",
  infoSoft: "rgba(157, 186, 255, 0.14)",
  codeBackground: "#111419",
  overlay: "rgba(7, 10, 15, 0.66)",
  shadow: "#000000",
  statusConnected: "#3fa564",
  statusConnecting: "#e08c00",
  statusDisconnected: "#e04b3f",
};

export function KitTestProvider({ children }: { children: ReactNode }) {
  return (
    <KitProvider colors={testColors} serverUrl="http://127.0.0.1:43100">
      {children}
    </KitProvider>
  );
}
