import { createContext, useContext } from "react";

/** Resolves the image a unit ships to something an `<img>` can show. */
export interface UnitIconLoader {
  load(source: string, icon: string, version?: string, state?: string): Promise<string>;
}

/** Pure presentation dependency: native overlay documents have no RPC client. */
export const WorkspaceIconsContext = createContext<UnitIconLoader | null>(null);
export const useWorkspaceIcons = () => useContext(WorkspaceIconsContext);
