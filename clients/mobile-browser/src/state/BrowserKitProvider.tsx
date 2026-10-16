import type { ReactNode } from "react";
import { useAtomValue } from "jotai";
import { KitProvider } from "@workspace/client-kit-native/ui";
import { shellClientAtom } from "./shellClientAtom";
import { themeColorsAtom } from "./themeAtoms";

/**
 * Supplies the client kit with this app's palette and the server whose units it
 * shows, read from the nearest jotai store (the root one, or a workspace
 * session's own).
 */
export function BrowserKitProvider({ children }: { children: ReactNode }) {
  const colors = useAtomValue(themeColorsAtom);
  const shellClient = useAtomValue(shellClientAtom);
  return (
    <KitProvider colors={colors} serverUrl={shellClient?.serverUrl ?? ""}>
      {children}
    </KitProvider>
  );
}
