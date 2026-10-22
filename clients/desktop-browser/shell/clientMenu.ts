import { problemReportingConversation } from "@vibestudio/shared/problemReportingConversation";
import {
  desktopAccelerator,
  desktopKeyPlatform,
  type DesktopBindingId,
  type DesktopKeyPlatform,
} from "@vibestudio/shared/desktopKeymap";
import { ABOUT_PAGES } from "@vibestudio/workspace-contracts/aboutNamespace";
import { localShellEvents } from "./localShellEvents";

/**
 * This client's native menus (`native-menus`). The host owns no browser UI: it
 * builds the application menu and the menu-button popup from the data below,
 * hands a chosen entry back as its action id, and only the compositor-bound
 * work (zoom, fullscreen, display repair, panel cycling) runs in the host, via
 * `panelHost.run`.
 */

export interface MenuItem {
  id?: string;
  label?: string;
  accelerator?: string;
  chromeOwned?: boolean;
  role?: string;
  separator?: true;
  submenu?: MenuItem[];
}

export interface MenuModel {
  menus: Array<{ label: string; items: MenuItem[] }>;
  popup: MenuItem[];
  /** macOS only: entries of the application menu, after About. */
  app?: MenuItem[];
}

/**
 * Chords that belong to the client no matter what has keyboard focus, so a
 * misbehaving page cannot swallow how a person gets out of it. Closing a panel
 * is deliberately not here: it is unrecoverable, so it stays with the menu.
 */
const CHROME_OWNED: readonly DesktopBindingId[] = [
  "commandPalette",
  "panelDevTools",
  "back",
  "forward",
  "forceReload",
  "reload",
  "focusAddress",
  "findInPage",
  "findNext",
  "findPrevious",
  "newPanel",
  "nextPanel",
  "previousPanel",
  "toggleFullScreen",
];

export function keyPlatformOfBrowser(userAgent: string): DesktopKeyPlatform {
  return desktopKeyPlatform(/Macintosh|Mac OS X/u.test(userAgent) ? "darwin" : "linux");
}

export function buildClientMenu(platform: DesktopKeyPlatform): MenuModel {
  const item = (id: string, label: string, binding?: DesktopBindingId): MenuItem => ({
    id,
    label,
    ...(binding
      ? {
          accelerator: desktopAccelerator(binding, platform),
          ...(CHROME_OWNED.includes(binding) ? { chromeOwned: true as const } : {}),
        }
      : {}),
  });
  const sep: MenuItem = { separator: true };

  const newPanel = item("new-panel", "New Panel", "newPanel");
  const command = item("command", "Command…", "commandPalette");
  const focusApproval = item("focus-approval", "Focus Pending Approval", "focusApproval");
  const switchWorkspace = item("switch-workspace", "Switch Workspace…", "switchWorkspace");
  const settings = item("settings", "Settings…");
  const bookmarks = item("about:bookmarks", "Bookmarks…", "bookmarks");
  const history = item("about:history", "History…", "history");
  const downloads = item("about:downloads", "Downloads…");
  const credentials = item("about:credentials", "Credentials…");
  const permissions = item("about:permissions", "Permissions…");
  const back = item("back", "Back", "back");
  const forward = item("forward", "Forward", "forward");
  const reload = item("reload-panel", "Reload Panel", "reload");
  const forceReload = item("force-reload-view", "Force Reload View", "forceReload");
  const stop = item("stop", "Stop Loading");
  const focusAddress = item("focus-address", "Focus Address Bar", "focusAddress");
  const addressBar = item("toggle-address-bar", "Toggle Address Bar");
  const find = item("find", "Find in Page…", "findInPage");
  const findNext = item("find-next", "Find Next", "findNext");
  const findPrevious = item("find-previous", "Find Previous", "findPrevious");
  const nextPanel = item("next-panel", "Next Panel", "nextPanel");
  const previousPanel = item("previous-panel", "Previous Panel", "previousPanel");
  const closePanel = item("close-panel", "Close Panel", "closePanel");
  const zoomIn = item("zoom-in", "Zoom In", "zoomIn");
  const zoomOut = item("zoom-out", "Zoom Out", "zoomOut");
  const resetZoom = item("reset-zoom", "Reset Zoom", "resetZoom");
  const fullScreen = item("toggle-fullscreen", "Toggle Full Screen", "toggleFullScreen");
  const panelFullScreen = item("toggle-panel-fullscreen", "Toggle Panel Full Screen");
  const refreshDisplay = item("refresh-display", "Refresh Panel Display");
  const copyDiagnostics = item("copy-display-diagnostics", "Copy Panel Display Diagnostics");
  const panelDevTools = item("panel-devtools", "Toggle Panel DevTools", "panelDevTools");
  const clientDevTools = item("client-devtools", "Toggle Client DevTools", "appDevTools");
  const clearBuildCache = item("clear-build-cache", "Clear Build Cache");
  const shortcuts = item("about:keyboard-shortcuts", "Keyboard Shortcuts", "keyboardShortcuts");
  const documentation = item("about:help", "Documentation");
  const report = item("report-problem", "Report a problem");
  const about = item("about:about", "About Vibestudio");

  const isMac = platform === "mac";
  return {
    menus: [
      {
        label: "File",
        items: [
          newPanel,
          sep,
          command,
          focusApproval,
          sep,
          switchWorkspace,
          ...(isMac ? [] : [settings]),
          sep,
          bookmarks,
          history,
          downloads,
          sep,
          nextPanel,
          previousPanel,
          ...(isMac ? [sep, closePanel] : []),
        ],
      },
      {
        label: "View",
        items: [
          back,
          forward,
          sep,
          reload,
          forceReload,
          stop,
          sep,
          focusAddress,
          addressBar,
          find,
          findNext,
          findPrevious,
          sep,
          refreshDisplay,
          copyDiagnostics,
          sep,
          resetZoom,
          zoomIn,
          zoomOut,
          sep,
          fullScreen,
          panelFullScreen,
          sep,
          panelDevTools,
          clientDevTools,
        ],
      },
      {
        label: "Help",
        items: [shortcuts, sep, documentation, credentials, permissions, report, about],
      },
    ],
    popup: [
      newPanel,
      focusApproval,
      sep,
      {
        label: "Panel",
        submenu: [
          back,
          forward,
          sep,
          reload,
          forceReload,
          stop,
          sep,
          focusAddress,
          addressBar,
          find,
          sep,
          nextPanel,
          previousPanel,
          sep,
          closePanel,
        ],
      },
      { label: "View", submenu: [zoomIn, zoomOut, resetZoom, sep, fullScreen, panelFullScreen, sep, refreshDisplay, copyDiagnostics] },
      { label: "Workspace", submenu: [switchWorkspace, settings, sep, bookmarks, history, downloads, sep, credentials, permissions] },
      { label: "Developer", submenu: [panelDevTools, clientDevTools, sep, clearBuildCache] },
      { label: "Help", submenu: [command, shortcuts, documentation, sep, report, about] },
    ],
    // On macOS Settings lives in the application menu, not under File.
    ...(isMac ? { app: [settings] } : {}),
  };
}

export interface MenuActionContext {
  /** Run something only the host's compositor can do to the panel surface. */
  panelHost(action: string): Promise<void>;
  clearBuildCache(): Promise<void>;
  /** Tell the person a menu action failed. */
  failed(action: string, error: unknown): void;
}

const ABOUT_PAGE: Record<string, string> = {
  "about:bookmarks": ABOUT_PAGES.BOOKMARKS,
  "about:history": ABOUT_PAGES.HISTORY,
  "about:downloads": ABOUT_PAGES.DOWNLOADS,
  "about:credentials": ABOUT_PAGES.CREDENTIALS,
  "about:permissions": ABOUT_PAGES.PERMISSIONS,
  "about:keyboard-shortcuts": ABOUT_PAGES.KEYBOARD_SHORTCUTS,
  "about:help": ABOUT_PAGES.HELP,
  "about:about": ABOUT_PAGES.ABOUT,
};

const HOST_ACTIONS: Record<string, string> = {
  "zoom-in": "zoom-in",
  "zoom-out": "zoom-out",
  "reset-zoom": "reset-zoom",
  "toggle-fullscreen": "toggle-fullscreen",
  "toggle-panel-fullscreen": "toggle-panel-fullscreen",
  "refresh-display": "refresh-display",
  "copy-display-diagnostics": "copy-display-diagnostics",
  "client-devtools": "toggle-client-devtools",
  "close-panel": "close-focused-panel",
  "next-panel": "next-panel",
  "previous-panel": "previous-panel",
};

/** Perform a chosen menu entry: this client's own commands, or a host-only compositor action. */
export function runMenuAction(actionId: string, context: MenuActionContext): void {
  const fail = (error: unknown) => context.failed(actionId, error);
  const hostAction = HOST_ACTIONS[actionId];
  if (hostAction) {
    context.panelHost(hostAction).catch(fail);
    return;
  }
  const page = ABOUT_PAGE[actionId];
  if (page) {
    localShellEvents.emit("navigate-about", { page });
    return;
  }
  switch (actionId) {
    case "new-panel":
      localShellEvents.emit("navigate-about", { page: ABOUT_PAGES.NEW });
      return;
    case "command":
      localShellEvents.emit("open-command-palette");
      return;
    case "focus-approval":
      localShellEvents.emit("focus-approval-card");
      return;
    case "switch-workspace":
      localShellEvents.emit("open-workspace-switcher", {});
      return;
    case "settings":
      localShellEvents.emit("open-settings", { section: "connection" });
      return;
    case "reload-panel":
      localShellEvents.emit("panel-chrome-command", { command: "reload-panel" });
      return;
    case "force-reload-view":
      localShellEvents.emit("panel-chrome-command", { command: "force-reload-view" });
      return;
    case "stop":
      localShellEvents.emit("panel-chrome-command", { command: "stop" });
      return;
    case "back":
      localShellEvents.emit("panel-chrome-command", { command: "back" });
      return;
    case "forward":
      localShellEvents.emit("panel-chrome-command", { command: "forward" });
      return;
    case "focus-address":
      localShellEvents.emit("panel-chrome-command", { command: "focus-address" });
      return;
    case "find-next":
      localShellEvents.emit("find-in-page-step", { forward: true });
      return;
    case "find-previous":
      localShellEvents.emit("find-in-page-step", { forward: false });
      return;
    case "toggle-address-bar":
      localShellEvents.emit("toggle-address-bar");
      return;
    case "find":
      localShellEvents.emit("toggle-find-in-page");
      return;
    case "panel-devtools":
      localShellEvents.emit("toggle-panel-devtools");
      return;
    case "clear-build-cache":
      context.clearBuildCache().catch(fail);
      return;
    case "report-problem":
      localShellEvents.emit("open-command-agent", { prompt: problemReportingConversation() });
      return;
    default:
      fail(new Error(`Unknown menu action: ${actionId}`));
  }
}
