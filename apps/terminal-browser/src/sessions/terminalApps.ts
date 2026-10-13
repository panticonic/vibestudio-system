import type { RpcClient } from "@vibestudio/rpc";
import { mainRpcMethods } from "@vibestudio/service-schemas/mainRpc";
import { EventsClient } from "@vibestudio/service-schemas/clients/eventsClient";
import type { WorkspaceTreeNode } from "@vibestudio/service-schemas/workspace";

/** Where terminal apps live in a workspace's source tree: `terminal-apps/<name>`. */
export const TERMINAL_APPS_DIR = "terminal-apps/";

/** A terminal app the launcher can start: a panel hosted by terminals. */
export interface TerminalApp {
  source: string;
  title: string;
  description?: string;
  /** An emoji; icons that are asset paths are not shown in a terminal. */
  icon?: string;
}

/** Every terminal app in the workspace `rpc` reaches, alphabetically. */
export async function listTerminalApps(rpc: RpcClient): Promise<TerminalApp[]> {
  const tree = await rpc.call("main", mainRpcMethods["workspace.sourceTree"], []);
  const apps: TerminalApp[] = [];
  const visit = (node: WorkspaceTreeNode) => {
    const launchable = node.launchable;
    if (launchable && !launchable.hidden && node.path.startsWith(TERMINAL_APPS_DIR)) {
      const icon = emojiIcon(launchable.icon);
      apps.push({
        source: node.path,
        title: launchable.title || node.name,
        ...(launchable.description ? { description: launchable.description } : {}),
        ...(icon ? { icon } : {}),
      });
    }
    for (const child of node.children) visit(child);
  };
  for (const node of tree.children) visit(node);
  return apps.sort((a, b) => a.title.localeCompare(b.title));
}

/** The icon when it is an emoji (a few pictographic characters), else nothing. */
export function emojiIcon(icon: string | undefined): string | undefined {
  if (!icon) return undefined;
  const trimmed = icon.trim();
  if ([...trimmed].length > 8 || !/\p{Extended_Pictographic}/u.test(trimmed)) return undefined;
  if (/[\p{L}\p{N}/.]/u.test(trimmed)) return undefined;
  return trimmed;
}

/**
 * Call `listener` whenever the workspace's units change (an app was added,
 * built or removed, or the workspace finished starting), so the launcher's
 * list follows the workspace instead of a snapshot taken at startup.
 */
export function onTerminalAppsChanged(rpc: RpcClient, listener: () => void): () => void {
  const events = new EventsClient(rpc);
  const stop = events.on("workspace:units-changed", () => listener());
  void events
    .subscribe("workspace:units-changed")
    .catch((error: unknown) => console.warn("[terminal-browser] app updates are unavailable:", error));
  return () => {
    stop();
    void events.unsubscribe("workspace:units-changed").catch(() => {});
  };
}
