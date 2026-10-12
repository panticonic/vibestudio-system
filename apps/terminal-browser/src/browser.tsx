import React from "react";
import { Box, Text } from "ink";
import { randomUUID } from "node:crypto";
import * as os from "node:os";
import * as path from "node:path";
import type { ApprovalDecisionId } from "@vibestudio/shared/approvalContract";
import type { PendingApproval } from "@vibestudio/shared/approvals";
import type {
  TerminalBrowserExit,
  TerminalBrowserHost,
  TerminalBrowserWorkspace,
  TerminalServerConnectionState,
} from "@vibestudio/shell-core/terminal/terminalBrowserHost";
import { bytesToBase64 } from "@workspace/terminal-host-protocol";
import type { TerminalSessionRecord } from "@workspace-workers/terminal-sessions/contract";
import { createApprovalsClient, type ApprovalsClient } from "./approvals/approvalsClient.js";
import { ApprovalsOverlay } from "./approvals/ApprovalsOverlay.js";
import {
  applyInstallReviewNav,
  focusedRowKeyOf,
  INITIAL_INSTALL_REVIEW_NAV,
  routeApprovalDigit,
  shouldHandleInstallReviewNav,
  type InstallReviewNavState,
} from "./approvals/installReviewNav.js";
import { Compositor } from "./compositor/compositor.js";
import { InkLayer } from "./compositor/inkLayer.js";
import type { CursorState, Rect, Screen } from "./compositor/screen.js";
import { fuzzyFilter } from "./input/fuzzy.js";
import { KeyRouter, prefixBytes, prefixLabel, type Command } from "./input/keymap.js";
import {
  InputTokenizer,
  navKeyOf,
  type InputEvent,
  type KeyEvent,
  type MouseEvent,
} from "./input/tokenizer.js";
import {
  SessionRegistryClient,
  createSessionContext,
  listTerminalApps,
  type TerminalApp,
} from "./sessions/registry.js";
import {
  TerminalSessionClient,
  describeError,
  type HostRequest,
} from "./sessions/sessionClient.js";
import { DEFAULT_SETTINGS, SETTING_ROWS, parseSettings, type BrowserSettings } from "./settings.js";
import { TerminalOwnership, captureConsole, type CapturedConsole } from "./tty/terminal.js";
import {
  FileRequestDialog,
  HelpOverlay,
  ListOverlay,
  LogsOverlay,
  MessageBox,
  OpenUrlDialog,
  SettingsOverlay,
  StatusBar,
  TabStrip,
  type ListItem,
  type LogLine,
  type StatusView,
  type TabView,
} from "./ui/chrome.js";
import { clampScroll } from "./ui/Scrollable.js";

const MIN_COLUMNS = 40;
const MIN_ROWS = 8;
/** Largest file a session may receive through `requestFile` (it travels base64-encoded over RPC). */
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_LOG_LINES = 1000;

const DECISION_BY_DIGIT: Record<number, ApprovalDecisionId> = {
  1: "once",
  2: "session",
  3: "version",
  4: "deny",
};

interface ListState {
  query: string;
  selected: number;
}

type Overlay =
  | ({ kind: "palette" } & ListState)
  | ({ kind: "launcher" } & ListState)
  | {
      kind: "approvals";
      selected: number;
      scroll: number;
      contentHeight: number;
      nav: InstallReviewNavState;
      origin?: string;
    }
  | { kind: "help"; scroll: number; contentHeight: number }
  | { kind: "logs"; scroll: number }
  | { kind: "settings"; selected: number; error: string | null }
  | ({
      kind: "workspaces";
      workspaces: TerminalBrowserWorkspace[] | null;
      error: string | null;
    } & ListState)
  | { kind: "confirm-close"; sessionId: string }
  | { kind: "open-url"; session: TerminalSessionClient; requestId: string; url: string }
  | {
      kind: "request-file";
      session: TerminalSessionClient;
      requestId: string;
      prompt?: string;
      path: string;
      error: string | null;
      busy: boolean;
    };

interface CopyState {
  sessionId: string;
  /** Absolute buffer row shown at the top of the session area. */
  top: number;
  cursor: { x: number; y: number };
  anchor: { x: number; y: number } | null;
}

interface PaletteEntry extends ListItem {
  run: () => void;
}

interface Layout {
  columns: number;
  rows: number;
  tooSmall: boolean;
  tabs: Rect;
  body: Rect;
  status: Rect;
}

/**
 * The terminal browser: owns the TTY, composes session grids and its own Ink
 * chrome into one screen, routes keys (prefix commands vs. session input),
 * and manages sessions, approvals and the user's host-side confirmations.
 */
export class TerminalBrowser {
  private readonly terminal: TerminalOwnership;
  private readonly tokenizer = new InputTokenizer();
  private readonly router: KeyRouter;
  private readonly registry: SessionRegistryClient;
  private readonly approvalsClient: ApprovalsClient;
  private readonly compositor: Compositor;
  private readonly tabsLayer: InkLayer;
  private readonly statusLayer: InkLayer;
  private readonly overlayLayer: InkLayer;

  private settings: BrowserSettings = DEFAULT_SETTINGS;
  private sessions: TerminalSessionClient[] = [];
  private focusedIndex = -1;
  private previousFocusedIndex = -1;
  private resumable: TerminalSessionRecord[] = [];
  private registryProblem: string | null = null;
  private apps: TerminalApp[] | null = null;
  private appsProblem: string | null = null;
  private approvals: PendingApproval[] = [];
  private seenApprovals = new Set<string>();
  private overlay: Overlay | null = null;
  private launcher: ListState = { query: "", selected: 0 };
  private copy: CopyState | null = null;
  private readonly hostRequests = new Map<string, HostRequest[]>();
  private notice: string | null = null;
  private readonly logs: LogLine[] = [];
  private connection: TerminalServerConnectionState;
  private overlayVisible = false;
  private overlayRect: Rect = { x: 0, y: 0, width: 1, height: 1 };
  private chromeScheduled = false;
  private finished = false;
  private settle!: {
    resolve: (exit: TerminalBrowserExit) => void;
    reject: (error: unknown) => void;
  };
  private readonly cleanups: Array<() => void> = [];
  private console: CapturedConsole | null = null;

  constructor(private readonly host: TerminalBrowserHost) {
    this.terminal = new TerminalOwnership({ stdin: host.stdin, stdout: host.stdout });
    this.router = new KeyRouter(this.settings.prefixKey);
    this.registry = new SessionRegistryClient(host.rpc);
    this.approvalsClient = createApprovalsClient(host.rpc);
    this.connection = host.connectionState();
    const layout = this.layout();
    const onLayerFrame = () => this.compositor.invalidate();
    this.tabsLayer = new InkLayer({ columns: layout.columns, rows: 1 }, onLayerFrame);
    this.statusLayer = new InkLayer({ columns: layout.columns, rows: 1 }, onLayerFrame);
    this.overlayLayer = new InkLayer(
      { columns: layout.columns, rows: Math.max(1, layout.body.height) },
      onLayerFrame
    );
    this.compositor = new Compositor(
      { write: (data) => this.terminal.write(data) },
      () => ({ columns: this.layout().columns, rows: this.layout().rows }),
      (screen) => this.compose(screen)
    );
  }

  /** Run until the user quits, switches workspace, or the server is gone. */
  run(): Promise<TerminalBrowserExit> {
    const { stdin, stdout } = this.host;
    if (!stdin.isTTY || !stdout.isTTY) {
      return Promise.reject(
        new Error(
          "The terminal browser needs an interactive terminal: run it directly in a terminal window, not through a pipe or redirect."
        )
      );
    }
    const done = new Promise<TerminalBrowserExit>((resolve, reject) => {
      this.settle = { resolve, reject };
    });
    try {
      this.console = captureConsole((level, message) => this.log(level, message));
      this.terminal.acquire({ mouse: this.settings.mouse });
      this.listen();
      this.renderChrome();
      void this.load();
    } catch (error) {
      this.fail(error);
    }
    return done;
  }

  // ── lifecycle ──────────────────────────────────────────────────────────────

  private listen(): void {
    const { stdin, stdout } = this.host;
    const onData = (chunk: Buffer | string) => this.guard(() => this.onInput(chunk));
    stdin.on("data", onData);
    this.cleanups.push(() => stdin.off("data", onData));

    const onResize = () => this.guard(() => this.onResize());
    stdout.on("resize", onResize);
    this.cleanups.push(() => stdout.off("resize", onResize));

    this.cleanups.push(
      this.host.onConnectionState((state) => this.guard(() => this.onConnectionState(state)))
    );

    // Explicit termination requests end the browser like quitting does.
    const onSignal = () => this.finish({ kind: "quit" });
    const onContinue = () =>
      this.guard(() => {
        this.terminal.reassert();
        this.compositor.invalidateAll();
      });
    for (const signal of ["SIGTERM", "SIGHUP", "SIGINT"] as const) {
      process.on(signal, onSignal);
      this.cleanups.push(() => process.off(signal, onSignal));
    }
    process.on("SIGCONT", onContinue);
    this.cleanups.push(() => process.off("SIGCONT", onContinue));

    this.cleanups.push(
      this.approvalsClient.onChange(() => {
        void this.refreshApprovals();
      })
    );
  }

  private async load(): Promise<void> {
    const settings = this.registry.getSettings().then(
      (raw) => this.applySettings(parseSettings(raw), false),
      (error: unknown) =>
        this.log("warn", `Settings could not be loaded; using defaults: ${describeError(error)}`)
    );
    const sessions = this.refreshResumable();
    const apps = this.refreshApps();
    void this.refreshApprovals();
    await Promise.all([settings, sessions, apps]);
    if (this.finished) return;
    // Resume where the person left off: the most recently used session.
    const latest = this.resumable[0];
    if (latest && this.sessions.length === 0) {
      this.openTab(latest);
      const more = this.resumable.length;
      if (more > 0) {
        this.setNotice(
          `Resumed ${latest.title} · ${more} more in the launcher (${this.prefix()} c)`
        );
      }
    }
    this.changed();
  }

  /** Settle `run` exactly once and hand the terminal back. */
  private finish(exit: TerminalBrowserExit, error?: unknown): void {
    if (this.finished) return;
    this.finished = true;
    for (const cleanup of this.cleanups.splice(0).reverse()) {
      try {
        cleanup();
      } catch {
        // keep tearing down
      }
    }
    for (const session of this.sessions) session.dispose();
    this.sessions = [];
    this.compositor.stop();
    this.tabsLayer.dispose();
    this.statusLayer.dispose();
    this.overlayLayer.dispose();
    this.terminal.release();
    this.console?.restore();
    if (error !== undefined) this.settle.reject(error);
    else this.settle.resolve(exit);
  }

  private fail(error: unknown): void {
    this.finish({ kind: "quit" }, error);
  }

  /** Run an event handler; an internal error ends the browser cleanly instead of wedging the TTY. */
  private guard(action: () => void): void {
    if (this.finished) return;
    try {
      action();
    } catch (error) {
      this.fail(error);
    }
  }

  private onConnectionState(state: TerminalServerConnectionState): void {
    const previous = this.connection;
    this.connection = state;
    if (state.phase === "lost") {
      this.finish({ kind: "connection-lost", cause: state.cause });
      return;
    }
    if (state.phase === "connected" && previous.phase !== "connected") {
      this.log("info", "Reconnected to the server");
      // The attachments did not survive the outage: reattach and catch up.
      for (const session of this.sessions) {
        if (session.status.kind === "disconnected" || session.status.kind === "error") {
          void session.attach(this.sessions[this.focusedIndex] === session);
        }
      }
      void this.refreshApprovals();
      void this.refreshResumable();
    } else if (state.phase === "reconnecting") {
      this.log("warn", `Connection interrupted: ${state.cause}`);
    }
    this.changed();
  }

  private onResize(): void {
    const layout = this.layout();
    for (const session of this.sessions) session.resize(this.sessionSize(layout));
    this.tabsLayer.resize({ columns: layout.columns, rows: 1 });
    this.statusLayer.resize({ columns: layout.columns, rows: 1 });
    this.copy = null;
    this.compositor.invalidateAll();
    this.changed();
  }

  // ── data ───────────────────────────────────────────────────────────────────

  private async refreshResumable(): Promise<void> {
    try {
      const rows = await this.registry.list();
      const open = new Set(this.sessions.map((s) => s.sessionId));
      this.resumable = rows.filter((row) => !open.has(row.sessionId));
      this.registryProblem = null;
    } catch (error) {
      this.registryProblem = describeError(error);
      this.log("warn", `Session registry unavailable: ${this.registryProblem}`);
    }
    this.changed();
  }

  private async refreshApps(): Promise<void> {
    try {
      this.apps = await listTerminalApps(this.host.rpc);
      this.appsProblem = null;
    } catch (error) {
      this.appsProblem = describeError(error);
      this.apps = this.apps ?? [];
      this.log("error", `Could not list terminal apps: ${this.appsProblem}`);
    }
    this.changed();
  }

  private async refreshApprovals(): Promise<void> {
    let pending: PendingApproval[];
    try {
      pending = await this.approvalsClient.list();
    } catch (error) {
      this.log("warn", `Approvals could not be refreshed: ${describeError(error)}`);
      return;
    }
    if (this.finished) return;
    const fresh = pending.filter((approval) => !this.seenApprovals.has(approval.approvalId));
    this.seenApprovals = new Set(pending.map((approval) => approval.approvalId));
    const emptied = this.approvals.length > 0 && pending.length === 0;
    this.approvals = pending;
    const focused = this.focusedSession();
    if (this.overlay?.kind === "approvals") {
      const overlay = this.overlay;
      // The queue was worked through: get out of the way. (Opened empty: stay, it says so.)
      if (emptied) this.overlay = null;
      else overlay.selected = Math.max(0, Math.min(overlay.selected, pending.length - 1));
    } else if (focused && this.settings.autoOpenApprovals && !this.isModalOpen()) {
      const index = pending.findIndex(
        (approval) => fresh.includes(approval) && approval.callerId === focused.targetId
      );
      if (index !== -1) this.openApprovals(index, `requested by ${focused.title} (this tab)`);
    }
    this.changed();
  }

  // ── layout & composition ───────────────────────────────────────────────────

  private layout(): Layout {
    const columns = Math.max(1, this.host.stdout.columns ?? 80);
    const rows = Math.max(1, this.host.stdout.rows ?? 24);
    const tooSmall = columns < MIN_COLUMNS || rows < MIN_ROWS;
    return {
      columns,
      rows,
      tooSmall,
      tabs: { x: 0, y: 0, width: columns, height: 1 },
      body: { x: 0, y: 1, width: columns, height: Math.max(1, rows - 2) },
      status: { x: 0, y: rows - 1, width: columns, height: 1 },
    };
  }

  private sessionSize(layout = this.layout()): { columns: number; rows: number } {
    return { columns: layout.body.width, rows: layout.body.height };
  }

  private compose(screen: Screen): CursorState {
    const layout = this.layout();
    const hidden: CursorState = { x: 0, y: 0, visible: false };
    if (layout.tooSmall) {
      const message = `Terminal too small: need ${MIN_COLUMNS}×${MIN_ROWS}, have ${layout.columns}×${layout.rows}`;
      screen.text(0, Math.floor(layout.rows / 2), message.slice(0, layout.columns), {
        fg: 3,
        attrs: 1,
      });
      return hidden;
    }
    this.tabsLayer.grid.paint(screen, layout.tabs);
    const session = this.focusedSession();
    if (session) {
      const copy = this.copy?.sessionId === session.sessionId ? this.copy : null;
      session.grid.paint(screen, layout.body, {
        scrollback: copy ? session.grid.liveTop() - copy.top : 0,
        selection: copy ? normalizedSelection(copy) : null,
        marker: copy ? copy.cursor : null,
      });
    }
    if (this.overlayVisible) this.overlayLayer.grid.paint(screen, this.overlayRect);
    this.statusLayer.grid.paint(screen, layout.status);
    if (!session || this.overlayVisible || this.copy || !session.isLive()) return hidden;
    const cursor = session.grid.cursor();
    if (!cursor.visible || cursor.x >= layout.body.width || cursor.y >= layout.body.height)
      return hidden;
    return { x: layout.body.x + cursor.x, y: layout.body.y + cursor.y, visible: true };
  }

  /** Schedule one chrome render for this event-loop turn. */
  private changed(): void {
    if (this.finished || this.chromeScheduled) return;
    this.chromeScheduled = true;
    setImmediate(() => {
      this.chromeScheduled = false;
      this.guard(() => this.renderChrome());
    });
  }

  private renderChrome(): void {
    // With nothing open, the launcher is the screen.
    if (!this.overlay && this.sessions.length === 0) {
      this.overlay = { kind: "launcher", ...this.launcher };
    }
    const layout = this.layout();
    this.tabsLayer.update(
      <TabStrip
        tabs={this.tabViews()}
        width={layout.columns}
        brand={`Vibestudio · ${this.host.workspace.name}`}
      />
    );
    this.statusLayer.update(<StatusBar view={this.statusView()} width={layout.columns} />);
    const overlay = this.overlayElement(layout);
    this.overlayVisible = overlay !== null;
    if (overlay) {
      this.overlayRect = overlay.rect;
      this.overlayLayer.resize({ columns: overlay.rect.width, rows: overlay.rect.height });
      this.overlayLayer.update(overlay.element);
    }
    this.compositor.invalidate();
  }

  private tabViews(): TabView[] {
    return this.sessions.map((session, index) => {
      const approvals = this.approvals.some((approval) => approval.callerId === session.targetId);
      const requests = (this.hostRequests.get(session.sessionId)?.length ?? 0) > 0;
      const app = this.apps?.find((candidate) => candidate.source === session.record.source);
      return {
        title: session.title,
        ...(app?.icon ? { icon: app.icon } : {}),
        focused: index === this.focusedIndex,
        badge: approvals ? "!" : requests ? "?" : session.attention ? "●" : null,
        status: session.isLive()
          ? "live"
          : session.status.kind === "attaching"
            ? "attaching"
            : "problem",
      };
    });
  }

  private statusView(): StatusView {
    const prefix = this.prefix();
    let hint: string | undefined;
    if (this.copy) {
      hint = "COPY ↑↓ move · v select · y copy · q leave";
    }
    return {
      workspace: this.host.workspace.name,
      server: `${this.host.server.endpoint}${this.host.server.kind === "owned" ? " (local)" : ""}`,
      connection:
        this.connection.phase === "connected"
          ? { phase: "connected" }
          : { phase: this.connection.phase, cause: this.connection.cause },
      approvals: this.approvals.length,
      prefixLabel: prefix,
      prefixPending: this.router.pending,
      ...(hint ? { hint } : {}),
      notice: this.notice,
    };
  }

  private centered(layout: Layout, width: number, height: number): Rect {
    const w = Math.min(width, layout.body.width);
    const h = Math.min(height, layout.body.height);
    return {
      x: layout.body.x + Math.floor((layout.body.width - w) / 2),
      y: layout.body.y + Math.floor((layout.body.height - h) / 2),
      width: w,
      height: h,
    };
  }

  private overlayElement(layout: Layout): { rect: Rect; element: React.ReactElement } | null {
    const overlay = this.overlay;
    const body = layout.body;
    const prefix = this.prefix();
    if (!overlay) {
      const session = this.focusedSession();
      if (!session || session.isLive()) return null;
      const message = this.sessionMessage(session);
      const rect = this.centered(layout, Math.min(72, body.width - 4), Math.min(8, body.height));
      return { rect, element: <MessageBox {...message} width={rect.width} height={rect.height} /> };
    }
    switch (overlay.kind) {
      case "palette": {
        const rect = {
          ...this.centered(layout, Math.min(80, body.width - 4), Math.min(22, body.height)),
          y: body.y,
        };
        const items = this.paletteItems(overlay.query);
        overlay.selected = Math.min(overlay.selected, Math.max(0, items.length - 1));
        return {
          rect,
          element: (
            <ListOverlay
              title="Commands"
              query={overlay.query}
              placeholder="type to search apps, sessions and actions"
              items={items}
              selected={overlay.selected}
              width={rect.width}
              height={rect.height}
              empty={<Text dimColor>{`Nothing matches “${overlay.query}”.`}</Text>}
              footer="↑↓ choose · Enter run · Esc close"
            />
          ),
        };
      }
      case "launcher": {
        const rect =
          this.sessions.length === 0
            ? body
            : this.centered(layout, Math.min(90, body.width - 2), body.height);
        const items = this.launcherItems(overlay.query);
        overlay.selected = Math.min(overlay.selected, Math.max(0, items.length - 1));
        return {
          rect,
          element: (
            <ListOverlay
              title={
                this.sessions.length === 0
                  ? `Vibestudio · ${this.host.workspace.name} — what would you like to open?`
                  : "Open"
              }
              query={overlay.query}
              placeholder="type to filter"
              items={items}
              selected={overlay.selected}
              width={rect.width}
              height={rect.height}
              empty={this.launcherEmpty(overlay.query)}
              footer={
                this.sessions.length === 0
                  ? `↑↓ choose · Enter open · ${prefix} ? help · ${prefix} q quit`
                  : "↑↓ choose · Enter open · Esc close"
              }
            />
          ),
        };
      }
      case "approvals":
        return {
          rect: body,
          element: (
            <ApprovalsOverlay
              pending={this.approvals}
              selectedIndex={overlay.selected}
              {...this.installReviewProps(overlay)}
              height={body.height}
              detailScroll={overlay.scroll}
              onDetailHeight={(rows) => {
                if (this.overlay === overlay && overlay.contentHeight !== rows) {
                  overlay.contentHeight = rows;
                }
              }}
              {...(overlay.origin ? { origin: overlay.origin } : {})}
            />
          ),
        };
      case "help":
        return {
          rect: this.centered(layout, Math.min(90, body.width), body.height),
          element: (
            <HelpOverlay
              prefixLabel={prefix}
              width={Math.min(90, body.width)}
              height={body.height}
              scroll={overlay.scroll}
              onContentHeight={(rows) => {
                if (this.overlay === overlay) overlay.contentHeight = rows;
              }}
            />
          ),
        };
      case "logs":
        return {
          rect: body,
          element: (
            <LogsOverlay
              lines={this.logs}
              width={body.width}
              height={body.height}
              scroll={overlay.scroll}
              {...(this.host.server.logFile ? { logFile: this.host.server.logFile } : {})}
            />
          ),
        };
      case "settings": {
        const rect = this.centered(layout, Math.min(72, body.width - 2), Math.min(14, body.height));
        return {
          rect,
          element: (
            <SettingsOverlay
              settings={this.settings}
              selected={overlay.selected}
              width={rect.width}
              height={rect.height}
              error={overlay.error}
            />
          ),
        };
      }
      case "workspaces": {
        const rect = {
          ...this.centered(layout, Math.min(70, body.width - 4), Math.min(16, body.height)),
          y: body.y,
        };
        const items = this.workspaceItems(overlay);
        return {
          rect,
          element: (
            <ListOverlay
              title="Switch workspace"
              query={overlay.query}
              placeholder="type to filter"
              items={items}
              selected={overlay.selected}
              width={rect.width}
              height={rect.height}
              empty={
                <Text dimColor>
                  {overlay.error
                    ? `Could not list workspaces: ${overlay.error}`
                    : overlay.workspaces === null
                      ? "Loading workspaces…"
                      : "No other workspaces."}
                </Text>
              }
              footer="↑↓ choose · Enter switch · Esc close"
            />
          ),
        };
      }
      case "confirm-close": {
        const session = this.sessions.find((s) => s.sessionId === overlay.sessionId);
        const rect = this.centered(layout, Math.min(64, body.width - 4), 7);
        return {
          rect,
          element: (
            <MessageBox
              title={`End ${session?.title ?? "this session"}?`}
              lines={[
                "The app discards this session's state and it can no longer be resumed.",
                `To keep it for later, press Esc and use ${prefix} d (detach) instead.`,
                "y end it · Esc keep it",
              ]}
              tone="warn"
              width={rect.width}
              height={rect.height}
            />
          ),
        };
      }
      case "open-url": {
        const rect = this.centered(layout, Math.min(80, body.width - 4), Math.min(11, body.height));
        return {
          rect,
          element: (
            <OpenUrlDialog
              sessionTitle={overlay.session.title}
              url={overlay.url}
              allowed={isOpenableUrl(overlay.url)}
              width={rect.width}
              height={rect.height}
            />
          ),
        };
      }
      case "request-file": {
        const rect = this.centered(layout, Math.min(80, body.width - 4), Math.min(12, body.height));
        return {
          rect,
          element: (
            <FileRequestDialog
              sessionTitle={overlay.session.title}
              {...(overlay.prompt ? { prompt: overlay.prompt } : {})}
              path={overlay.path}
              error={overlay.error}
              busy={overlay.busy}
              width={rect.width}
              height={rect.height}
            />
          ),
        };
      }
    }
  }

  private sessionMessage(session: TerminalSessionClient): {
    title: string;
    lines: string[];
    tone: "info" | "warn" | "error";
  } {
    const prefix = this.prefix();
    switch (session.status.kind) {
      case "attaching":
        return {
          title: `Opening ${session.title}…`,
          lines: ["Starting the app on the server."],
          tone: "info",
        };
      case "superseded":
        return {
          title: `${session.title} is open in another terminal`,
          lines: [`${prefix} r brings it back here · ${prefix} d closes this tab`],
          tone: "warn",
        };
      case "disconnected":
        return this.connection.phase === "connected"
          ? {
              title: `${session.title} stopped responding`,
              lines: [
                `${capitalize(session.status.reason)}.`,
                `${prefix} r reattach · ${prefix} x end the session · ${prefix} d close the tab`,
              ],
              tone: "warn",
            }
          : {
              title: "Reconnecting to the server…",
              lines: [`${session.title} reattaches by itself once the connection is back.`],
              tone: "warn",
            };
      case "error":
        return {
          title: `${session.title} could not be opened`,
          lines: [
            session.status.message,
            `${prefix} r try again · ${prefix} x end the session · ${prefix} l browser log`,
          ],
          tone: "error",
        };
      case "live":
        return { title: session.title, lines: [], tone: "info" };
    }
  }

  private installReviewProps(overlay: Extract<Overlay, { kind: "approvals" }>) {
    const current = this.approvals[overlay.selected];
    if (current?.kind !== "unit-install-review") return {};
    const rowKey = focusedRowKeyOf(overlay.nav, current.parts);
    return {
      partIndex: overlay.nav.partIndex,
      ...(overlay.nav.selection ? { installSelection: overlay.nav.selection } : {}),
      ...(rowKey ? { focusedRowKey: rowKey } : {}),
    };
  }

  // ── list contents ──────────────────────────────────────────────────────────

  private launcherEntries(): PaletteEntry[] {
    const entries: PaletteEntry[] = [];
    for (const record of this.resumable) {
      entries.push({
        key: `resume:${record.sessionId}`,
        section: "Resume",
        label: `${this.iconFor(record.source)}${record.title}`,
        detail: `${this.appTitle(record.source)} · last used ${relativeTime(record.lastAttachedAt)}`,
        hint: "resume",
        run: () => this.resume(record),
      });
    }
    for (const app of this.apps ?? []) {
      entries.push({
        key: `start:${app.source}`,
        section: "Start",
        label: `${app.icon ? `${app.icon} ` : ""}${app.title}`,
        detail: app.description ?? app.source,
        hint: "new",
        run: () => void this.launch(app),
      });
    }
    return entries;
  }

  private launcherItems(query: string): PaletteEntry[] {
    // Rank within each section so "Resume" and "Start" stay grouped and labelled.
    const entries = this.launcherEntries();
    const sections = [...new Set(entries.map((entry) => entry.section))];
    return sections.flatMap((section) =>
      fuzzyFilter(
        entries.filter((entry) => entry.section === section),
        query,
        (entry) => entry.label
      ).map(({ item, match }) => ({ ...item, match }))
    );
  }

  private launcherEmpty(query: string): React.ReactElement {
    if (query) return <Text dimColor>{`Nothing matches “${query}”.`}</Text>;
    if (this.apps === null) return <Text dimColor>Looking for terminal apps…</Text>;
    return (
      <Box flexDirection="column">
        {this.appsProblem ? (
          <Text color="red" wrap="wrap">{`Could not list terminal apps: ${this.appsProblem}`}</Text>
        ) : (
          <Text bold>This workspace has no terminal apps yet.</Text>
        )}
        <Text wrap="wrap">
          A terminal app is a worker whose package.json declares a terminal block, for example:
        </Text>
        <Text color="cyan">
          {'  "vibestudio": { "terminal": { "renderer": "ink", "title": "My app" } }'}
        </Text>
        <Text wrap="wrap">
          Its Durable Object renders an Ink UI with @workspace/terminal-shim. Ask an agent to “make
          a terminal app that …”, or read docs/terminal-apps.md. Apps appear here as soon as they
          are built.
        </Text>
      </Box>
    );
  }

  private paletteItems(query: string): PaletteEntry[] {
    const prefix = this.prefix();
    const focused = this.focusedSession();
    const entries: PaletteEntry[] = [];
    this.sessions.forEach((session, index) => {
      entries.push({
        key: `tab:${session.sessionId}`,
        label: `Go to ${index + 1}: ${session.title}`,
        hint: index < 9 ? `${prefix} ${index + 1}` : undefined,
        run: () => this.focusTab(index),
      });
    });
    for (const entry of this.launcherEntries()) {
      entries.push({
        ...entry,
        label: `${entry.section === "Resume" ? "Resume" : "Start"}: ${entry.label}`,
        section: undefined,
        detail: undefined,
        hint: entry.section === "Resume" ? "resume" : "new tab",
      });
    }
    const action = (key: string, label: string, run: () => void, hint?: string) =>
      entries.push({ key, label, run, ...(hint ? { hint } : {}) });
    action(
      "approvals",
      `Approvals${this.approvals.length ? ` (${this.approvals.length} waiting)` : ""}`,
      () => this.command({ kind: "approvals" }),
      `${prefix} a`
    );
    if (focused) {
      action(
        "copy",
        "Scroll back / copy text",
        () => this.command({ kind: "copy-mode" }),
        `${prefix} [`
      );
      action(
        "detach",
        `Detach ${focused.title}`,
        () => this.command({ kind: "detach" }),
        `${prefix} d`
      );
      action(
        "reattach",
        `Reattach ${focused.title}`,
        () => this.command({ kind: "reattach" }),
        `${prefix} r`
      );
      action("close", `End ${focused.title}`, () => this.command({ kind: "close" }), `${prefix} x`);
    }
    action("logs", "Browser log", () => this.command({ kind: "logs" }), `${prefix} l`);
    action(
      "settings",
      "Settings (prefix key, approvals, bell, mouse)",
      () => this.command({ kind: "settings" }),
      `${prefix} s`
    );
    action(
      "workspace",
      "Switch workspace",
      () => this.command({ kind: "workspace" }),
      `${prefix} w`
    );
    action("help", "Help: key bindings", () => this.command({ kind: "help" }), `${prefix} ?`);
    action(
      "quit",
      "Quit (sessions stay resumable)",
      () => this.command({ kind: "quit" }),
      `${prefix} q`
    );
    return fuzzyFilter(entries, query, (entry) => entry.label).map(({ item, match }) => ({
      ...item,
      match,
    }));
  }

  private workspaceItems(overlay: Extract<Overlay, { kind: "workspaces" }>): PaletteEntry[] {
    const entries = (overlay.workspaces ?? []).map((workspace) => ({
      key: workspace.id,
      label: workspace.name,
      hint: workspace.id === this.host.workspace.id ? "current" : undefined,
      run: () => {
        if (workspace.id === this.host.workspace.id) this.overlay = null;
        else this.finish({ kind: "switch-workspace", workspaceId: workspace.id });
      },
    }));
    const ranked = fuzzyFilter(entries, overlay.query, (entry) => entry.label).map(
      ({ item, match }) => ({
        ...item,
        match,
      })
    );
    overlay.selected = Math.min(overlay.selected, Math.max(0, ranked.length - 1));
    return ranked;
  }

  private iconFor(source: string): string {
    const icon = this.apps?.find((app) => app.source === source)?.icon;
    return icon ? `${icon} ` : "";
  }

  private appTitle(source: string): string {
    return this.apps?.find((app) => app.source === source)?.title ?? source;
  }

  // ── input ──────────────────────────────────────────────────────────────────

  private onInput(chunk: Buffer | string): void {
    const events = this.tokenizer.push(typeof chunk === "string" ? chunk : new Uint8Array(chunk));
    let sessionData = "";
    const flush = () => {
      if (sessionData) this.focusedSession()?.sendInput(sessionData);
      sessionData = "";
    };
    for (const routed of this.router.route(events)) {
      if (this.finished) return;
      if (routed.kind === "prefix") {
        this.changed();
        continue;
      }
      if (routed.kind !== "input") {
        flush();
        this.notice = null;
        if (routed.kind === "command") this.command(routed.command);
        else
          this.setNotice(
            `${this.prefix()} ${routed.key} does nothing — ${this.prefix()} ? lists the keys`
          );
        continue;
      }
      const event = routed.event;
      if (event.kind === "mouse") {
        flush();
        this.onMouse(event);
        continue;
      }
      if (this.notice && event.kind === "key") {
        this.notice = null;
        this.changed();
      }
      if (this.isModalOpen() || this.copy || !this.focusedSession()) {
        flush();
        this.onUiInput(event);
        continue;
      }
      sessionData += this.encodeForSession(event);
    }
    flush();
  }

  /** Whether the browser (not the session) currently takes keystrokes. */
  private isModalOpen(): boolean {
    return this.overlay !== null;
  }

  private encodeForSession(event: KeyEvent | Exclude<InputEvent, MouseEvent>): string {
    const session = this.focusedSession()!;
    if (event.kind === "paste") {
      return session.grid.bracketedPaste() ? `\x1b[200~${event.text}\x1b[201~` : event.text;
    }
    // Mirror the program's cursor-key mode: the real terminal stays in normal mode.
    if (session.grid.applicationCursorKeys()) {
      const match = /^\x1b\[([ABCDHF])$/.exec(event.seq);
      if (match) return `\x1bO${match[1]}`;
    }
    return event.seq;
  }

  private onMouse(event: MouseEvent): void {
    const layout = this.layout();
    if (layout.tooSmall) return;
    const session = this.focusedSession();
    const inBody =
      event.y >= layout.body.y &&
      event.y < layout.body.y + layout.body.height &&
      event.x < layout.body.width;
    if (this.isModalOpen()) {
      if (event.action === "wheel-up" || event.action === "wheel-down") {
        this.onUiInput({ kind: "key", name: event.action === "wheel-up" ? "up" : "down", seq: "" });
      }
      return;
    }
    if (event.y === layout.tabs.y && event.action === "press" && this.sessions.length > 0) {
      const share = Math.max(8, Math.floor((layout.columns - 1) / this.sessions.length));
      const index = Math.floor(event.x / share);
      if (index < this.sessions.length) this.focusTab(index);
      return;
    }
    if (!session || !inBody) return;
    const mode = session.grid.mouseMode();
    if (mode.tracking !== "none" && !this.copy && session.isLive()) {
      const encoded = encodeMouseForSession(event, layout.body, mode);
      if (encoded) session.sendInput(encoded);
      return;
    }
    if (event.action === "wheel-up") this.scrollCopy(session, -3);
    else if (event.action === "wheel-down") this.scrollCopy(session, 3);
  }

  /** Keys while the browser has focus: overlays, the launcher and copy mode. */
  private onUiInput(event: Exclude<InputEvent, MouseEvent>): void {
    const overlay = this.overlay;
    if (!overlay) {
      if (this.copy) this.onCopyKey(event);
      return;
    }
    switch (overlay.kind) {
      case "palette":
      case "launcher":
      case "workspaces": {
        const items =
          overlay.kind === "palette"
            ? this.paletteItems(overlay.query)
            : overlay.kind === "launcher"
              ? this.launcherItems(overlay.query)
              : this.workspaceItems(overlay);
        const result = editList(overlay, event, items.length);
        if (result === "cancel") {
          if (overlay.kind === "launcher" && this.sessions.length === 0) {
            this.setNotice(`Choose something to open, or press ${this.prefix()} q to quit`);
          } else this.overlay = null;
        } else if (result === "accept") {
          const item = items[overlay.selected];
          if (item) {
            this.overlay = null;
            item.run();
          }
        }
        if (overlay.kind === "launcher") {
          // Remember an unfinished search; a choice starts the next visit fresh.
          this.launcher =
            result === "accept"
              ? { query: "", selected: 0 }
              : { query: overlay.query, selected: overlay.selected };
        }
        break;
      }
      case "approvals":
        this.onApprovalsKey(overlay, event);
        break;
      case "help": {
        const height = Math.max(1, this.layout().body.height - 4);
        const scroll = scrollFor(event, overlay.scroll, height);
        if (scroll === "close") this.overlay = null;
        else if (scroll !== null)
          overlay.scroll = clampScroll(scroll, overlay.contentHeight, height);
        break;
      }
      case "logs": {
        const height = Math.max(1, this.layout().body.height - 4);
        const scroll = scrollFor(event, overlay.scroll, height, true);
        if (scroll === "close") this.overlay = null;
        else if (scroll !== null) {
          overlay.scroll = Math.min(Math.max(0, scroll), Math.max(0, this.logs.length - height));
        }
        break;
      }
      case "settings":
        this.onSettingsKey(overlay, event);
        break;
      case "confirm-close":
        if (event.kind === "key" && (event.name === "y" || event.name === "Y")) {
          this.overlay = null;
          void this.closeSession(overlay.sessionId);
        } else if (event.kind === "key" && (event.name === "escape" || event.name === "n")) {
          this.overlay = null;
        }
        break;
      case "open-url":
        if (event.kind === "key" && event.name === "o" && isOpenableUrl(overlay.url)) {
          this.overlay = null;
          void this.answerOpenUrl(overlay.session, overlay.requestId, overlay.url, true);
        } else if (event.kind === "key" && event.name === "escape") {
          this.overlay = null;
          void this.answerOpenUrl(overlay.session, overlay.requestId, overlay.url, false);
        }
        break;
      case "request-file":
        this.onFileRequestKey(overlay, event);
        break;
    }
    if (!this.overlay) this.nextHostRequest();
    this.changed();
  }

  private onApprovalsKey(
    overlay: Extract<Overlay, { kind: "approvals" }>,
    event: Exclude<InputEvent, MouseEvent>
  ): void {
    if (event.kind !== "key") return;
    const nav = navKeyOf(event);
    const target = this.approvals[overlay.selected];
    const detailRows = Math.max(1, this.layout().body.height - 8);
    if (nav === "escape") {
      this.overlay = null;
    } else if (nav === "up" || nav === "down") {
      const next = overlay.selected + (nav === "up" ? -1 : 1);
      overlay.selected = Math.min(Math.max(0, next), Math.max(0, this.approvals.length - 1));
      overlay.scroll = 0;
      overlay.nav = INITIAL_INSTALL_REVIEW_NAV;
    } else if (nav === "pageup" || nav === "pagedown") {
      const next = overlay.scroll + (nav === "pageup" ? -detailRows : detailRows);
      overlay.scroll = clampScroll(next, overlay.contentHeight, detailRows);
    } else if (nav === "home") {
      overlay.scroll = 0;
    } else if (nav === "end") {
      overlay.scroll = clampScroll(Number.MAX_SAFE_INTEGER, overlay.contentHeight, detailRows);
    } else if (shouldHandleInstallReviewNav(target, nav)) {
      overlay.nav = applyInstallReviewNav(overlay.nav, nav, target.parts);
    } else if (nav && typeof nav === "object" && "digit" in nav) {
      const route = routeApprovalDigit(target, nav.digit, overlay.nav.selection, DECISION_BY_DIGIT);
      if (route.via === "resolve") {
        void this.approvalsClient
          .resolve(route.approvalId, route.decision)
          .then(() => this.refreshApprovals())
          .catch((error: unknown) => this.reportApprovalFailure(error));
      } else if (route.via === "resolveInstallReview") {
        void this.approvalsClient
          .resolveInstallReview(route.approvalId, route.resolution)
          .then(() => this.refreshApprovals())
          .catch((error: unknown) => this.reportApprovalFailure(error));
      }
    }
  }

  private reportApprovalFailure(error: unknown): void {
    this.log("error", `Approval decision failed: ${describeError(error)}`);
    this.setNotice(`The decision was not recorded: ${describeError(error)}`);
  }

  private onSettingsKey(
    overlay: Extract<Overlay, { kind: "settings" }>,
    event: Exclude<InputEvent, MouseEvent>
  ): void {
    if (event.kind !== "key") return;
    const nav = navKeyOf(event);
    if (nav === "escape") this.overlay = null;
    else if (nav === "up") overlay.selected = Math.max(0, overlay.selected - 1);
    else if (nav === "down")
      overlay.selected = Math.min(SETTING_ROWS.length - 1, overlay.selected + 1);
    else if (
      nav === "left" ||
      nav === "right" ||
      nav === "enter" ||
      (nav && typeof nav === "object" && "char" in nav && nav.char === " ")
    ) {
      const row = SETTING_ROWS[overlay.selected]!;
      const next = row.step(this.settings, nav === "left" ? -1 : 1);
      this.applySettings(next, true);
    }
  }

  private onFileRequestKey(
    overlay: Extract<Overlay, { kind: "request-file" }>,
    event: Exclude<InputEvent, MouseEvent>
  ): void {
    if (overlay.busy) return;
    if (event.kind === "paste") {
      overlay.path += event.text.replace(/[\r\n]+/g, "");
      overlay.error = null;
      return;
    }
    if (event.name === "escape") {
      this.overlay = null;
      void this.replyFile(overlay.session, overlay.requestId, null);
    } else if (event.name === "enter") {
      if (!overlay.path.trim()) {
        overlay.error = "Type a path first, or press Esc to decline.";
        return;
      }
      overlay.busy = true;
      overlay.error = null;
      void this.sendFile(overlay);
    } else if (event.name === "backspace" || event.name === "C-h") {
      overlay.path = overlay.path.slice(0, -1);
    } else if (event.name === "C-u") {
      overlay.path = "";
    } else if ([...event.name].length === 1 && event.name >= " ") {
      overlay.path += event.name;
      overlay.error = null;
    }
  }

  // ── commands ───────────────────────────────────────────────────────────────

  private command(command: Command): void {
    const session = this.focusedSession();
    switch (command.kind) {
      case "palette":
        this.overlay = { kind: "palette", query: "", selected: 0 };
        break;
      case "launcher":
        this.overlay = { kind: "launcher", query: "", selected: 0 };
        void this.refreshApps();
        void this.refreshResumable();
        break;
      case "tab":
        if (command.index < this.sessions.length) this.focusTab(command.index);
        else this.setNotice(`There is no tab ${command.index + 1}`);
        break;
      case "next-tab":
      case "prev-tab":
        if (this.sessions.length > 0) {
          const delta = command.kind === "next-tab" ? 1 : -1;
          this.focusTab((this.focusedIndex + delta + this.sessions.length) % this.sessions.length);
        }
        break;
      case "last-tab":
        if (this.previousFocusedIndex >= 0 && this.previousFocusedIndex < this.sessions.length) {
          this.focusTab(this.previousFocusedIndex);
        }
        break;
      case "copy-mode":
        if (session) this.enterCopy(session);
        break;
      case "approvals":
        this.openApprovals(0);
        void this.refreshApprovals();
        break;
      case "logs":
        this.overlay = { kind: "logs", scroll: 0 };
        break;
      case "help":
        this.overlay = { kind: "help", scroll: 0, contentHeight: 0 };
        break;
      case "settings":
        this.overlay = { kind: "settings", selected: 0, error: null };
        break;
      case "detach":
        if (session) this.detachTab(session);
        break;
      case "close":
        if (session) this.overlay = { kind: "confirm-close", sessionId: session.sessionId };
        break;
      case "reattach":
        if (session) void session.attach(true);
        break;
      case "workspace":
        this.openWorkspaces();
        break;
      case "quit":
        this.finish({ kind: "quit" });
        return;
      case "send-prefix":
        if (session && !this.overlay) session.sendInput(prefixBytes(this.settings.prefixKey));
        break;
    }
    this.changed();
  }

  private openApprovals(selected: number, origin?: string): void {
    this.copy = null;
    this.overlay = {
      kind: "approvals",
      selected: Math.min(selected, Math.max(0, this.approvals.length - 1)),
      scroll: 0,
      contentHeight: 0,
      nav: INITIAL_INSTALL_REVIEW_NAV,
      ...(origin ? { origin } : {}),
    };
  }

  private openWorkspaces(): void {
    const overlay: Extract<Overlay, { kind: "workspaces" }> = {
      kind: "workspaces",
      workspaces: null,
      error: null,
      query: "",
      selected: 0,
    };
    this.overlay = overlay;
    void this.host.listWorkspaces().then(
      (workspaces) => {
        overlay.workspaces = workspaces;
        this.changed();
      },
      (error: unknown) => {
        overlay.error = describeError(error);
        this.changed();
      }
    );
  }

  private applySettings(next: BrowserSettings, persist: boolean): void {
    const previous = this.settings;
    this.settings = next;
    if (next.prefixKey !== previous.prefixKey) this.router.setPrefix(next.prefixKey);
    if (next.mouse !== previous.mouse) this.terminal.setMouse(next.mouse);
    if (persist) {
      void this.registry.setSettings({ ...next }).then(
        () => {
          if (this.overlay?.kind === "settings") this.overlay.error = null;
          this.changed();
        },
        (error: unknown) => {
          if (this.overlay?.kind === "settings") {
            this.overlay.error = `Not saved (applies until you quit): ${describeError(error)}`;
          }
          this.changed();
        }
      );
    }
    this.changed();
  }

  // ── sessions ───────────────────────────────────────────────────────────────

  private focusedSession(): TerminalSessionClient | null {
    return this.sessions[this.focusedIndex] ?? null;
  }

  private sessionEvents() {
    return {
      changed: () => this.changed(),
      titled: (session: TerminalSessionClient) => {
        // Remembered so the launcher shows the session's own title after a restart.
        void this.registry
          .setTitle(session.sessionId, session.title)
          .catch((error: unknown) =>
            this.log(
              "warn",
              `Could not remember the title of ${session.title}: ${describeError(error)}`
            )
          );
        this.changed();
      },
      output: () => this.compositor.invalidate(),
      hostRequest: (session: TerminalSessionClient, request: HostRequest) =>
        this.guard(() => this.onHostRequest(session, request)),
      ended: (session: TerminalSessionClient, reason: string | undefined) =>
        this.guard(() => this.onSessionEnded(session, reason)),
      bell: (session: TerminalSessionClient) => this.guard(() => this.onBell(session)),
      log: (level: "info" | "warn" | "error", message: string) => this.log(level, message),
    };
  }

  private openTab(record: TerminalSessionRecord): TerminalSessionClient {
    const existing = this.sessions.findIndex((session) => session.sessionId === record.sessionId);
    if (existing !== -1) {
      this.focusTab(existing);
      return this.sessions[existing]!;
    }
    const session = new TerminalSessionClient(
      this.host.rpc,
      record,
      this.sessionSize(),
      this.sessionEvents()
    );
    this.sessions.push(session);
    this.resumable = this.resumable.filter((row) => row.sessionId !== record.sessionId);
    this.focusTab(this.sessions.length - 1);
    void session.attach(true).then(() => this.changed());
    this.changed();
    return session;
  }

  private resume(record: TerminalSessionRecord): void {
    this.openTab(record);
    void this.registry
      .markAttached(record.sessionId)
      .catch((error: unknown) =>
        this.log(
          "warn",
          `Could not record that ${record.title} was resumed: ${describeError(error)}`
        )
      );
  }

  private async launch(app: TerminalApp): Promise<void> {
    this.setNotice(`Starting ${app.title}…`);
    let contextId: string;
    try {
      contextId = await createSessionContext(this.host.rpc);
    } catch (error) {
      this.log("error", `Could not start ${app.title}: ${describeError(error)}`);
      this.setNotice(
        `Could not start ${app.title}: ${describeError(error)} (details: ${this.prefix()} l)`
      );
      return;
    }
    const draft = {
      sessionId: `term-${randomUUID()}`,
      source: app.source,
      className: app.className,
      title: app.title,
      contextId,
    };
    let record: TerminalSessionRecord;
    try {
      record = await this.registry.record(draft);
    } catch (error) {
      record = { ...draft, createdAt: Date.now(), lastAttachedAt: Date.now() };
      this.log("warn", `${app.title} will not be resumable: ${describeError(error)}`);
      this.setNotice(
        `${app.title} opened, but cannot be resumed later (session registry unavailable)`
      );
    }
    if (this.finished) return;
    this.openTab(record);
    if (this.notice === `Starting ${app.title}…`) this.notice = null;
    this.changed();
  }

  private focusTab(index: number): void {
    if (index < 0 || index >= this.sessions.length) return;
    if (index === this.focusedIndex) return;
    this.focusedSession()?.setFocused(false);
    this.previousFocusedIndex = this.focusedIndex;
    this.focusedIndex = index;
    this.copy = null;
    if (this.overlay?.kind === "launcher" || this.overlay?.kind === "palette") this.overlay = null;
    const session = this.sessions[index]!;
    session.setFocused(true);
    if (!this.overlay) this.nextHostRequest();
    if (!this.overlay && this.settings.autoOpenApprovals) {
      const pendingIndex = this.approvals.findIndex(
        (approval) => approval.callerId === session.targetId
      );
      if (pendingIndex !== -1)
        this.openApprovals(pendingIndex, `requested by ${session.title} (this tab)`);
    }
    this.compositor.invalidate();
    this.changed();
  }

  private removeTab(session: TerminalSessionClient): void {
    const index = this.sessions.indexOf(session);
    if (index === -1) return;
    session.dispose();
    this.hostRequests.delete(session.sessionId);
    this.sessions.splice(index, 1);
    if (this.overlay && "session" in this.overlay && this.overlay.session === session)
      this.overlay = null;
    if (this.copy?.sessionId === session.sessionId) this.copy = null;
    const wasFocused = index === this.focusedIndex;
    if (this.focusedIndex > index || (wasFocused && this.focusedIndex >= this.sessions.length)) {
      this.focusedIndex -= 1;
    }
    this.previousFocusedIndex = -1;
    if (this.sessions.length === 0) {
      this.focusedIndex = -1;
    } else if (wasFocused) {
      const next = this.focusedIndex;
      this.focusedIndex = -1;
      this.focusTab(Math.max(0, next));
    }
    this.compositor.invalidate();
    this.changed();
  }

  private detachTab(session: TerminalSessionClient): void {
    this.removeTab(session);
    this.setNotice(`Detached ${session.title} — resume it from the launcher (${this.prefix()} c)`);
    void this.refreshResumable();
  }

  private async closeSession(sessionId: string): Promise<void> {
    const session = this.sessions.find((candidate) => candidate.sessionId === sessionId);
    if (!session) return;
    try {
      await session.close();
    } catch (error) {
      this.log("warn", `${session.title} did not confirm closing: ${describeError(error)}`);
    }
    await this.registry
      .forget(sessionId)
      .catch((error: unknown) =>
        this.log(
          "warn",
          `Could not remove ${session.title} from the session list: ${describeError(error)}`
        )
      );
    this.removeTab(session);
    this.setNotice(`Ended ${session.title}`);
  }

  private onSessionEnded(session: TerminalSessionClient, reason: string | undefined): void {
    if (!this.sessions.includes(session)) return;
    void this.registry.forget(session.sessionId).catch(() => {});
    this.removeTab(session);
    this.setNotice(`${session.title} ended${reason && reason !== "closed" ? `: ${reason}` : ""}`);
  }

  private onBell(session: TerminalSessionClient): void {
    const focused = session === this.focusedSession();
    if (!focused && !session.attention) {
      session.attention = { reason: "bell" };
      this.changed();
    }
    if (focused || this.settings.bell) this.terminal.write("\x07");
  }

  // ── host requests ──────────────────────────────────────────────────────────

  private onHostRequest(session: TerminalSessionClient, request: HostRequest): void {
    const queue = this.hostRequests.get(session.sessionId) ?? [];
    queue.push(request);
    this.hostRequests.set(session.sessionId, queue);
    if (session === this.focusedSession() && !this.overlay) this.nextHostRequest();
    else if (session !== this.focusedSession()) {
      const what = request.kind === "open-url" ? "wants to open a link" : "asks for a file";
      const index = this.sessions.indexOf(session);
      this.setNotice(`${session.title} ${what} — switch to it with ${this.prefix()} ${index + 1}`);
    }
    this.changed();
  }

  /** Show the focused session's next pending host request, if any. */
  private nextHostRequest(): void {
    const session = this.focusedSession();
    if (!session || this.overlay) return;
    const request = this.hostRequests.get(session.sessionId)?.shift();
    if (!request) return;
    this.copy = null;
    this.overlay =
      request.kind === "open-url"
        ? { kind: "open-url", session, requestId: request.requestId, url: request.url }
        : {
            kind: "request-file",
            session,
            requestId: request.requestId,
            ...(request.prompt ? { prompt: request.prompt } : {}),
            path: "",
            error: null,
            busy: false,
          };
  }

  private async answerOpenUrl(
    session: TerminalSessionClient,
    requestId: string,
    url: string,
    open: boolean
  ): Promise<void> {
    let opened = false;
    if (open) {
      try {
        await this.host.openExternal(url);
        opened = true;
        this.setNotice(`Opened ${new URL(url).host} in your browser`);
      } catch (error) {
        this.log("error", `Could not open ${url}: ${describeError(error)}`);
        this.setNotice(`Could not open the link: ${describeError(error)}`);
      }
    }
    await session
      .reply({ requestId, kind: "open-url", opened })
      .catch((error: unknown) =>
        this.log("warn", `${session.title} did not receive the answer: ${describeError(error)}`)
      );
  }

  private async sendFile(overlay: Extract<Overlay, { kind: "request-file" }>): Promise<void> {
    const filePath = expandHome(overlay.path.trim());
    try {
      const file = await this.host.readLocalFile(filePath);
      if (file.bytes.byteLength > MAX_FILE_BYTES) {
        throw new Error(
          `it is ${formatBytes(file.bytes.byteLength)}; files up to ${formatBytes(MAX_FILE_BYTES)} can be sent`
        );
      }
      await this.replyFile(overlay.session, overlay.requestId, {
        name: file.name,
        ...(file.mimeType ? { mimeType: file.mimeType } : {}),
        data: bytesToBase64(file.bytes),
      });
      if (this.overlay === overlay) this.overlay = null;
      this.setNotice(
        `Sent ${file.name} (${formatBytes(file.bytes.byteLength)}) to ${overlay.session.title}`
      );
    } catch (error) {
      overlay.error = `Could not send ${filePath}: ${describeError(error)}`;
      overlay.busy = false;
    }
    if (!this.overlay) this.nextHostRequest();
    this.changed();
  }

  private async replyFile(
    session: TerminalSessionClient,
    requestId: string,
    file: { name: string; mimeType?: string; data: string } | null
  ): Promise<void> {
    await session
      .reply({ requestId, kind: "request-file", ...(file ? { file } : {}) })
      .catch((error: unknown) =>
        this.log("warn", `${session.title} did not receive the file: ${describeError(error)}`)
      );
  }

  // ── copy mode ──────────────────────────────────────────────────────────────

  private enterCopy(session: TerminalSessionClient): void {
    const grid = session.grid;
    const cursor = grid.cursor();
    this.copy = {
      sessionId: session.sessionId,
      top: grid.liveTop(),
      cursor: { x: Math.min(cursor.x, grid.columns - 1), y: grid.liveTop() + cursor.y },
      anchor: null,
    };
  }

  private scrollCopy(session: TerminalSessionClient, delta: number): void {
    if (!this.copy || this.copy.sessionId !== session.sessionId) {
      if (delta > 0) return; // already live
      this.enterCopy(session);
    }
    const copy = this.copy!;
    const grid = session.grid;
    copy.top = Math.min(Math.max(0, copy.top + delta), grid.liveTop());
    copy.cursor.y = Math.min(Math.max(copy.top, copy.cursor.y), copy.top + grid.rows - 1);
    if (copy.top === grid.liveTop() && delta > 0 && !copy.anchor) this.copy = null;
    this.changed();
  }

  private onCopyKey(event: Exclude<InputEvent, MouseEvent>): void {
    const copy = this.copy;
    const session = this.focusedSession();
    if (!copy || !session || event.kind !== "key") return;
    const grid = session.grid;
    const last = grid.length() - 1;
    const page = grid.rows;
    const move = (dx: number, dy: number) => {
      copy.cursor.x = Math.min(Math.max(0, copy.cursor.x + dx), grid.columns - 1);
      copy.cursor.y = Math.min(Math.max(0, copy.cursor.y + dy), last);
    };
    switch (event.name) {
      case "up":
      case "k":
        move(0, -1);
        break;
      case "down":
      case "j":
        move(0, 1);
        break;
      case "left":
      case "h":
        move(-1, 0);
        break;
      case "right":
      case "l":
        move(1, 0);
        break;
      case "pageup":
      case "C-b":
        move(0, -page);
        break;
      case "pagedown":
      case "C-f":
        move(0, page);
        break;
      case "g":
      case "home":
        copy.cursor = { x: 0, y: 0 };
        break;
      case "G":
      case "end":
        copy.cursor = { x: 0, y: last };
        break;
      case "0":
        copy.cursor.x = 0;
        break;
      case "$":
        copy.cursor.x = Math.max(0, grid.lineText(copy.cursor.y).length - 1);
        break;
      case "v":
      case " ":
        copy.anchor = copy.anchor ? null : { ...copy.cursor };
        break;
      case "y":
      case "enter": {
        const text = selectedText(grid, copy);
        this.terminal.write(`\x1b]52;c;${Buffer.from(text, "utf8").toString("base64")}\x07`);
        this.copy = null;
        this.setNotice(
          `Copied ${text.length} character${text.length === 1 ? "" : "s"} to your clipboard (if your terminal allows OSC 52)`
        );
        return;
      }
      case "q":
      case "escape":
        this.copy = null;
        this.changed();
        return;
      default:
        return;
    }
    // Keep the cursor in view.
    if (copy.cursor.y < copy.top) copy.top = copy.cursor.y;
    if (copy.cursor.y > copy.top + page - 1) copy.top = copy.cursor.y - page + 1;
    copy.top = Math.min(Math.max(0, copy.top), grid.liveTop());
    this.changed();
  }

  // ── misc ───────────────────────────────────────────────────────────────────

  private prefix(): string {
    return prefixLabel(this.settings.prefixKey);
  }

  private setNotice(notice: string | null): void {
    this.notice = notice;
    this.changed();
  }

  private log(level: LogLine["level"], message: string): void {
    this.logs.push({ time: Date.now(), level, message });
    if (this.logs.length > MAX_LOG_LINES) this.logs.splice(0, this.logs.length - MAX_LOG_LINES);
    if (this.overlay?.kind === "logs") this.changed();
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────

/** Text-field + list navigation shared by the palette, launcher and workspace list. */
function editList(
  state: ListState,
  event: Exclude<InputEvent, MouseEvent>,
  count: number
): "accept" | "cancel" | null {
  if (event.kind === "paste") {
    state.query += event.text.replace(/[\r\n]+/g, " ");
    state.selected = 0;
    return null;
  }
  switch (event.name) {
    case "escape":
      return "cancel";
    case "enter":
      return "accept";
    case "up":
    case "C-p":
    case "backtab":
      state.selected = Math.max(0, state.selected - 1);
      return null;
    case "down":
    case "C-n":
    case "tab":
      state.selected = Math.min(Math.max(0, count - 1), state.selected + 1);
      return null;
    case "pageup":
      state.selected = Math.max(0, state.selected - 10);
      return null;
    case "pagedown":
      state.selected = Math.min(Math.max(0, count - 1), state.selected + 10);
      return null;
    case "backspace":
    case "C-h":
      state.query = state.query.slice(0, -1);
      state.selected = 0;
      return null;
    case "C-u":
      state.query = "";
      state.selected = 0;
      return null;
  }
  if ([...event.name].length === 1 && event.name >= " ") {
    state.query += event.name;
    state.selected = 0;
  }
  return null;
}

/** New scroll position for a scrollable overlay, "close", or null for keys it ignores. */
function scrollFor(
  event: Exclude<InputEvent, MouseEvent>,
  scroll: number,
  page: number,
  fromBottom = false
): number | "close" | null {
  if (event.kind !== "key") return null;
  const up = fromBottom ? 1 : -1;
  switch (event.name) {
    case "escape":
    case "q":
      return "close";
    case "up":
    case "k":
      return scroll + up;
    case "down":
    case "j":
      return scroll - up;
    case "pageup":
      return scroll + up * page;
    case "pagedown":
      return scroll - up * page;
    case "home":
    case "g":
      return fromBottom ? Number.MAX_SAFE_INTEGER : 0;
    case "end":
    case "G":
      return fromBottom ? 0 : Number.MAX_SAFE_INTEGER;
  }
  return null;
}

function normalizedSelection(copy: CopyState) {
  if (!copy.anchor) return null;
  const a = copy.anchor;
  const b = copy.cursor;
  const aFirst = a.y < b.y || (a.y === b.y && a.x <= b.x);
  return { start: aFirst ? a : b, end: aFirst ? b : a };
}

function selectedText(grid: TerminalSessionClient["grid"], copy: CopyState): string {
  const selection = normalizedSelection(copy);
  if (!selection) return grid.lineText(copy.cursor.y);
  const lines: string[] = [];
  for (let y = selection.start.y; y <= selection.end.y; y++) {
    const line = grid.lineText(y, false);
    const from = y === selection.start.y ? selection.start.x : 0;
    const to = y === selection.end.y ? selection.end.x + 1 : line.length;
    lines.push(line.slice(from, to).replace(/\s+$/, ""));
  }
  return lines.join("\n");
}

function encodeMouseForSession(
  event: MouseEvent,
  body: Rect,
  mode: { tracking: "none" | "x10" | "vt200" | "drag" | "any"; sgr: boolean }
): string | null {
  if (mode.tracking === "x10" && event.action !== "press") return null;
  if (
    (event.action === "drag" || event.action === "move") &&
    mode.tracking !== "drag" &&
    mode.tracking !== "any"
  ) {
    return null;
  }
  const x = event.x - body.x + 1;
  const y = event.y - body.y + 1;
  if (mode.sgr) return `\x1b[<${event.code};${x};${y}${event.action === "release" ? "m" : "M"}`;
  if (x > 222 || y > 222) return null;
  const code = event.action === "release" ? 3 | (event.code & ~3 & ~64) : event.code;
  return `\x1b[M${String.fromCharCode(32 + code, 32 + x, 32 + y)}`;
}

function isOpenableUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

function expandHome(filePath: string): string {
  if (filePath === "~") return os.homedir();
  if (filePath.startsWith("~/")) return path.join(os.homedir(), filePath.slice(2));
  return path.resolve(filePath);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function relativeTime(timestamp: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
