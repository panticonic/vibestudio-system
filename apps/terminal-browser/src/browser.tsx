import React from "react";
import { Text } from "ink";
import type { PendingApproval } from "@vibestudio/shared/approvals";
import type { DurableObservation } from "@vibestudio/shell-core/durableObservation";
import type {
  TerminalBrowserExit,
  TerminalBrowserHost,
  TerminalBrowserWorkspace,
  TerminalServerConnectionState,
} from "@vibestudio/shell-core/terminal/terminalBrowserHost";
import { createApprovalsClient, type ApprovalsClient } from "./approvals/approvalsClient.js";
import { ApprovalsOverlay } from "./approvals/ApprovalsOverlay.js";
import { approvalRequestedBy } from "./approvals/approvalRequester.js";
import {
  applyInstallReviewNav,
  focusedRowKeyOf,
  INITIAL_INSTALL_REVIEW_NAV,
  routeApprovalDigit,
  shouldHandleInstallReviewNav,
  type InstallReviewNavState,
} from "./approvals/installReviewNav.js";
import {
  applyTaskRulesNav,
  effectiveTaskRuleSelection,
  INITIAL_TASK_RULES_NAV,
  isTaskRulesApproval,
  shouldHandleTaskRulesNav,
  type TaskRulesNavState,
} from "./approvals/taskRulesNav.js";
import { Compositor } from "./compositor/compositor.js";
import { InkLayer } from "./compositor/inkLayer.js";
import type { CursorState, Rect, Screen } from "./compositor/screen.js";
import { fuzzyFilter } from "./input/fuzzy.js";
import {
  KeyRouter,
  approvalsKeyLabel,
  prefixBytes,
  prefixLabel,
  type Command,
} from "./input/keymap.js";
import {
  InputTokenizer,
  navKeyOf,
  type InputEvent,
  type KeyEvent,
  type MouseEvent,
} from "./input/tokenizer.js";
import {
  createTerminalSessions,
  type TerminalSessionEntry,
  type TerminalSessions,
  type TerminalSettingsStore,
} from "./sessions/launcher.js";
import {
  ShellSessionTab,
  describeError,
  describeExit,
  shellClient,
  type ShellClient,
} from "./sessions/shellSession.js";
import {
  emojiIcon,
  listTerminalApps,
  onTerminalAppsChanged,
  type TerminalApp,
} from "./sessions/terminalApps.js";
import { DEFAULT_SETTINGS, SETTING_ROWS, parseSettings, type BrowserSettings } from "./settings.js";
import { TerminalOwnership, captureConsole, type CapturedConsole } from "./tty/terminal.js";
import {
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
const MAX_LOG_LINES = 1000;

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
      taskRules: TaskRulesNavState;
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
  | ({ kind: "links"; tabTitle: string; urls: string[] } & ListState)
  | { kind: "open-url"; tabTitle: string; url: string };

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

/** The browser's server-side services; the launch service by default. */
export interface TerminalBrowserServices {
  /** The person's terminal sessions in the shown workspace. */
  sessions: TerminalSessions;
  /** The person's browser settings (kept in System). */
  settings: TerminalSettingsStore;
}

/**
 * The terminal browser: a tmux-like client of the person's terminal sessions
 * in the shown workspace. It owns the TTY, composes session grids and its own
 * Ink chrome into one screen, routes keys (prefix commands vs. session input),
 * and shows approvals and link confirmations in chrome no program can draw.
 */
export class TerminalBrowser {
  private readonly terminal: TerminalOwnership;
  private readonly tokenizer = new InputTokenizer();
  private readonly router: KeyRouter;
  private readonly services: TerminalBrowserServices;
  private readonly shell: ShellClient;
  private readonly approvalsClient: ApprovalsClient;
  private readonly compositor: Compositor;
  private readonly tabsLayer: InkLayer;
  private readonly statusLayer: InkLayer;
  private readonly overlayLayer: InkLayer;

  private settings: BrowserSettings = DEFAULT_SETTINGS;
  private sessions: ShellSessionTab[] = [];
  private focusedIndex = -1;
  private previousFocusedIndex = -1;
  /** The person's sessions in the shown workspace, newest activity first (null until listed). */
  private entries: TerminalSessionEntry[] | null = null;
  private sessionsProblem: string | null = null;
  /** Bumped per applied session list, so a listing older than an event is dropped. */
  private entriesGeneration = 0;
  /**
   * The last title a session's program set (OSC 0/2) while it had a tab, by
   * session id, so its Resume row reads as the tab did. Known only to this
   * browser: the registry keeps the app's title, not the program's.
   */
  private readonly programTitles = new Map<string, string>();
  /** Tabs whose session appeared in a list: only those can be found to have ended. */
  private readonly listedTabs = new WeakSet<ShellSessionTab>();
  private apps: TerminalApp[] | null = null;
  private appsProblem: string | null = null;
  private approvals: PendingApproval[] = [];
  private approvalObservation: DurableObservation | null = null;
  private seenApprovals = new Set<string>();
  private overlay: Overlay | null = null;
  private launcher: ListState = { query: "", selected: 0 };
  private copy: CopyState | null = null;
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

  constructor(
    private readonly host: TerminalBrowserHost,
    services?: TerminalBrowserServices
  ) {
    this.terminal = new TerminalOwnership({ stdin: host.stdin, stdout: host.stdout });
    this.router = new KeyRouter(this.settings.prefixKey);
    // Settings live in System (the browser's app principal); the workspace it
    // shows owns the apps, the person's sessions and their approvals, reached
    // as this device's session there.
    this.services = services ?? {
      sessions: createTerminalSessions(host.workspaceRpc),
      settings: createTerminalSessions(host.rpc),
    };
    this.shell = shellClient(host.workspaceRpc);
    this.approvalsClient = createApprovalsClient(host.workspaceRpc);
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

    const approvalObservation = this.approvalsClient.observe(
      (pending) => this.guard(() => this.applyApprovals(pending)),
      (error) => this.log("warn", `Approval queue observation failed: ${describeError(error)}`)
    );
    this.approvalObservation = approvalObservation;
    this.cleanups.push(() => {
      if (this.approvalObservation === approvalObservation) this.approvalObservation = null;
      void approvalObservation
        .stop()
        .catch((error: unknown) =>
          this.log("warn", `Approval queue retirement failed: ${describeError(error)}`)
        );
    });
    this.cleanups.push(
      this.services.sessions.onChange((entries) => this.guard(() => this.applyEntries(entries)))
    );
    this.cleanups.push(
      onTerminalAppsChanged(this.host.workspaceRpc, () => this.guard(() => void this.refreshApps()))
    );
  }

  private async load(): Promise<void> {
    const settings = this.services.settings.getSettings().then(
      (raw) => this.applySettings(parseSettings(raw), false),
      (error: unknown) =>
        this.log("warn", `Settings could not be loaded; using defaults: ${describeError(error)}`)
    );
    const sessions = this.refreshSessions();
    const apps = this.refreshApps();
    void this.refreshApprovals();
    await Promise.all([settings, sessions, apps]);
    if (this.finished || this.sessions.length > 0) return;
    // Resume where the person left off: the most recently active running session.
    const latest = this.entries?.find((entry) => entry.running && entry.shellSessionId);
    if (latest) {
      this.openTab(latest);
      const more = this.resumable().length;
      this.setNotice(
        more > 0
          ? `Resumed ${latest.title} · ${more} more in the launcher (${this.prefix()} c)`
          : `Resumed ${latest.title}`
      );
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
      // The attachments did not survive the outage: resume each after the last byte it got.
      for (const session of this.sessions) {
        if (session.status.kind === "disconnected" || session.status.kind === "error") {
          void session.attach(this.sessions[this.focusedIndex] === session, false);
        }
      }
      void this.refreshApprovals();
      void this.refreshSessions();
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

  private async refreshSessions(): Promise<void> {
    const generation = this.entriesGeneration;
    try {
      const entries = await this.services.sessions.list();
      // A change event that arrived meanwhile is newer than this listing.
      if (generation === this.entriesGeneration) this.applyEntries(entries);
      this.sessionsProblem = null;
    } catch (error) {
      this.sessionsProblem = describeError(error);
      this.entries = this.entries ?? [];
      this.log("warn", `Sessions could not be listed: ${this.sessionsProblem}`);
    }
    this.changed();
  }

  /** The person's sessions changed: update the resume list and the open tabs. */
  private applyEntries(entries: TerminalSessionEntry[]): void {
    if (this.finished) return;
    this.entriesGeneration += 1;
    this.entries = [...entries].sort((a, b) => b.lastActiveAt - a.lastActiveAt);
    const byId = new Map(entries.map((entry) => [entry.sessionId, entry]));
    for (const session of [...this.sessions]) {
      const entry = byId.get(session.sessionId);
      if (!entry) {
        // A tab opened after this list was made is simply not in it yet.
        if (!this.listedTabs.has(session)) continue;
        // Ended (here or on another device): nothing is left to show.
        this.removeTab(session);
        this.setNotice(`${session.title} was ended`);
        continue;
      }
      this.listedTabs.add(session);
      if (session.updateEntry(entry) && entry.shellSessionId) {
        void session.attach(session === this.focusedSession(), true);
      }
    }
    this.changed();
  }

  /** Sessions that are not open in a tab, newest activity first. */
  private resumable(): TerminalSessionEntry[] {
    const open = new Set(this.sessions.map((session) => session.sessionId));
    return (this.entries ?? []).filter((entry) => !open.has(entry.sessionId));
  }

  private async refreshApps(): Promise<void> {
    try {
      this.apps = await listTerminalApps(this.host.workspaceRpc);
      this.appsProblem = null;
    } catch (error) {
      this.appsProblem = describeError(error);
      this.apps = this.apps ?? [];
      this.log("error", `Could not list terminal apps: ${this.appsProblem}`);
    }
    this.changed();
  }

  private async refreshApprovals(): Promise<void> {
    try {
      await this.approvalObservation?.refresh();
    } catch (error) {
      this.log("warn", `Approvals could not be refreshed: ${describeError(error)}`);
    }
  }

  private applyApprovals(pending: PendingApproval[]): void {
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
        (approval) =>
          fresh.includes(approval) && approvalRequestedBy(approval, focused.entry.principalId)
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
      const approvals = this.approvals.some((approval) =>
        approvalRequestedBy(approval, session.entry.principalId)
      );
      const icon = this.iconFor(session.entry);
      const kind = session.status.kind;
      return {
        title: session.title,
        ...(icon ? { icon } : {}),
        focused: index === this.focusedIndex,
        badge: approvals ? "!" : session.attention ? "●" : null,
        status:
          kind === "live" || kind === "attaching"
            ? kind
            : kind === "exited"
              ? "ended"
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
      if (!session || session.isLive() || this.copy) return null;
      const message = this.sessionMessage(session);
      const width = Math.min(76, body.width - 4);
      // Border and title, plus every line as it wraps inside the border and padding.
      const textWidth = Math.max(1, width - 4);
      const wrapped = message.lines.reduce(
        (rows, line) => rows + wrappedRows(line, textWidth),
        0
      );
      const height = Math.min(wrapped + 3, body.height);
      // An ended program's last output stays readable above the note.
      const rect =
        session.status.kind === "exited"
          ? {
              x: body.x + Math.floor((body.width - width) / 2),
              y: body.y + body.height - height,
              width,
              height,
            }
          : this.centered(layout, width, height);
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
        const running = session?.entry.running ?? false;
        const rect = this.centered(layout, Math.min(68, body.width - 4), 7);
        return {
          rect,
          element: (
            <MessageBox
              title={`End ${session?.title ?? "this session"}?`}
              lines={[
                running
                  ? "The program is stopped and the session can no longer be resumed."
                  : "The session and its output are discarded; it can no longer be resumed.",
                running
                  ? `To keep it running, press Esc and use ${prefix} d (detach) instead.`
                  : `To keep it in the launcher, press Esc and use ${prefix} d instead.`,
                "y end it · Esc keep it",
              ]}
              tone="warn"
              width={rect.width}
              height={rect.height}
            />
          ),
        };
      }
      case "links": {
        const rect = {
          ...this.centered(layout, Math.min(90, body.width - 4), Math.min(16, body.height)),
          y: body.y,
        };
        const items = this.linkItems(overlay);
        overlay.selected = Math.min(overlay.selected, Math.max(0, items.length - 1));
        return {
          rect,
          element: (
            <ListOverlay
              title={`Links in ${overlay.tabTitle}`}
              query={overlay.query}
              placeholder="type to filter"
              items={items}
              selected={overlay.selected}
              width={rect.width}
              height={rect.height}
              empty={<Text dimColor>{`Nothing matches “${overlay.query}”.`}</Text>}
              footer="↑↓ choose · Enter open… · Esc close"
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
              sessionTitle={overlay.tabTitle}
              url={overlay.url}
              allowed={isOpenableUrl(overlay.url)}
              width={rect.width}
              height={rect.height}
            />
          ),
        };
      }
    }
  }

  private sessionMessage(session: ShellSessionTab): {
    title: string;
    lines: string[];
    tone: "info" | "warn" | "error";
  } {
    const prefix = this.prefix();
    const restart = session.entry.kind === "app" ? "start it again" : "open a new shell";
    switch (session.status.kind) {
      case "attaching":
        return { title: `Attaching to ${session.title}…`, lines: [], tone: "info" };
      case "exited":
        return {
          title: `${session.title} ${describeExit(session.status)}`,
          lines: [
            `${prefix} r ${restart} · ${prefix} [ read its output · ${prefix} x end the session · ${prefix} d close the tab`,
          ],
          tone: session.status.code === 0 ? "info" : "warn",
        };
      case "disconnected":
      case "error":
        if (this.connection.phase !== "connected") {
          return {
            title: "Reconnecting to the server…",
            lines: [`${session.title} reattaches by itself once the connection is back.`],
            tone: "warn",
          };
        }
        return session.status.kind === "error"
          ? {
              title: `Problem with ${session.title}`,
              lines: [
                session.status.message,
                `${prefix} r try again · ${prefix} x end the session · ${prefix} l browser log`,
              ],
              tone: "error",
            }
          : {
              title: `Lost the connection to ${session.title}`,
              lines: [
                `${capitalize(session.status.reason)}; the program may still be running.`,
                `${prefix} r reattach · ${prefix} x end the session · ${prefix} d close the tab`,
              ],
              tone: "warn",
            };
      case "live":
        return { title: session.title, lines: [], tone: "info" };
    }
  }

  private installReviewProps(overlay: Extract<Overlay, { kind: "approvals" }>) {
    const current = this.approvals[overlay.selected];
    if (isTaskRulesApproval(current)) {
      return {
        taskRuleSelection: effectiveTaskRuleSelection(current, overlay.taskRules),
        taskRuleFocus: overlay.taskRules.rowIndex,
      };
    }
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
    const workspace = this.host.workspace.name;
    for (const entry of this.resumable()) {
      const icon = this.iconFor(entry);
      const state = entry.running ? "running" : entry.exit ? describeExit(entry.exit) : "ended";
      entries.push({
        key: `resume:${entry.sessionId}`,
        section: "Resume",
        label: `${icon ? `${icon} ` : ""}${this.programTitles.get(entry.sessionId) ?? entry.title}`,
        detail: `${this.kindLabel(entry)} · ${state} · active ${relativeTime(entry.lastActiveAt)}`,
        hint: entry.running ? "running" : "restart",
        run: () => void this.resume(entry),
      });
    }
    if (this.sessionsProblem) {
      entries.push({
        key: "resume:problem",
        section: "Resume",
        label: "Your sessions could not be listed",
        detail: this.sessionsProblem,
        hint: "retry",
        run: () => {
          this.command({ kind: "launcher" });
        },
      });
    }
    entries.push({
      key: "start:shell",
      section: "Start",
      label: "Shell",
      detail: `Your login shell in ${workspace}`,
      hint: "new",
      run: () => void this.launch(null),
    });
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
    if (this.appsProblem) {
      entries.push({
        key: "start:problem",
        section: "Start",
        label: "Terminal apps could not be listed",
        detail: this.appsProblem,
        hint: "retry",
        run: () => {
          this.command({ kind: "launcher" });
        },
      });
    } else if (this.apps?.length === 0) {
      entries.push({
        key: "start:none",
        section: "Start",
        label: `${workspace} has no terminal apps yet`,
        detail: "Programs in terminal-apps/<name> appear here once built. Ask an agent to “make a terminal app that …”.",
        hint: "help",
        run: () => {
          this.overlay = { kind: "help", scroll: 0, contentHeight: 0 };
        },
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
    return <Text dimColor>{`Nothing matches “${query}”.`}</Text>;
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
        "links",
        `Links in ${focused.title}`,
        () => this.command({ kind: "links" }),
        `${prefix} o`
      );
      action(
        "detach",
        `Detach ${focused.title} (keeps running)`,
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
      "Quit (programs keep running)",
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

  /** A session's emoji icon: its own, else its app's. */
  private iconFor(entry: TerminalSessionEntry): string | undefined {
    return (
      emojiIcon(entry.icon) ??
      (entry.source ? this.apps?.find((app) => app.source === entry.source)?.icon : undefined)
    );
  }

  private kindLabel(entry: TerminalSessionEntry): string {
    if (entry.kind === "shell") return "Shell";
    return this.apps?.find((app) => app.source === entry.source)?.title ?? entry.source ?? "App";
  }

  private linkItems(overlay: Extract<Overlay, { kind: "links" }>): PaletteEntry[] {
    const entries = overlay.urls.map((url) => ({
      key: url,
      label: url,
      hint: isOpenableUrl(url) ? undefined : "can't open",
      run: () => {
        this.overlay = { kind: "open-url", tabTitle: overlay.tabTitle, url };
      },
    }));
    return fuzzyFilter(entries, overlay.query, (entry) => entry.label).map(({ item, match }) => ({
      ...item,
      match,
    }));
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
    if (event.action === "press" && event.code === 0) {
      // A click on a link the program drew (OSC 8) asks to open it.
      const top = this.copy?.sessionId === session.sessionId ? this.copy.top : session.grid.liveTop();
      const url = session.grid.linkAt(event.x - layout.body.x, top + event.y - layout.body.y);
      if (url) {
        this.copy = null;
        this.overlay = { kind: "open-url", tabTitle: session.title, url };
        this.changed();
      }
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
      case "workspaces":
      case "links": {
        const items =
          overlay.kind === "palette"
            ? this.paletteItems(overlay.query)
            : overlay.kind === "launcher"
              ? this.launcherItems(overlay.query)
              : overlay.kind === "links"
                ? this.linkItems(overlay)
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
          void this.openUrl(overlay.url);
        } else if (event.kind === "key" && (event.name === "escape" || event.name === "q")) {
          this.overlay = null;
        }
        break;
    }
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
      overlay.taskRules = INITIAL_TASK_RULES_NAV;
    } else if (nav === "pageup" || nav === "pagedown") {
      const next = overlay.scroll + (nav === "pageup" ? -detailRows : detailRows);
      overlay.scroll = clampScroll(next, overlay.contentHeight, detailRows);
    } else if (nav === "home") {
      overlay.scroll = 0;
    } else if (nav === "end") {
      overlay.scroll = clampScroll(Number.MAX_SAFE_INTEGER, overlay.contentHeight, detailRows);
    } else if (shouldHandleInstallReviewNav(target, nav)) {
      overlay.nav = applyInstallReviewNav(overlay.nav, nav, target.parts);
    } else if (shouldHandleTaskRulesNav(target, nav)) {
      overlay.taskRules = applyTaskRulesNav(overlay.taskRules, nav, target);
    } else if (nav && typeof nav === "object" && "digit" in nav) {
      const route = routeApprovalDigit(target, nav.digit, overlay.nav.selection, overlay.taskRules);
      if (route.via === "resolve") {
        void this.approvalsClient
          .resolve(route.approvalId, route.decision)
          .then(() => this.refreshApprovals())
          .catch((error: unknown) => this.reportApprovalFailure(error));
      } else if (route.via === "resolveTaskRules") {
        void this.approvalsClient
          .resolveTaskRules(route.approvalId, route.resolution)
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
    this.setNotice(`Your decision was not recorded (details: ${this.prefix()} l)`);
    // The queue may have moved on (decided elsewhere, withdrawn): show what is waiting now.
    void this.refreshApprovals();
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
        void this.refreshSessions();
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
        if (session) void this.reattach(session);
        break;
      case "links":
        if (session) this.openLinks(session);
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
      taskRules: INITIAL_TASK_RULES_NAV,
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
      void this.services.settings.setSettings({ ...next }).then(
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

  private focusedSession(): ShellSessionTab | null {
    return this.sessions[this.focusedIndex] ?? null;
  }

  private sessionEvents() {
    return {
      changed: () => this.changed(),
      output: () => this.compositor.invalidate(),
      bell: (session: ShellSessionTab) => this.guard(() => this.onBell(session)),
      copy: (session: ShellSessionTab, text: string) =>
        this.guard(() => {
          this.copyToClipboard(text);
          this.setNotice(`Copied ${characters(text)} from ${session.title}`);
        }),
      log: (level: "info" | "warn" | "error", message: string) => this.log(level, message),
    };
  }

  /** Open (or focus) the tab of a session and attach it. */
  private openTab(entry: TerminalSessionEntry): ShellSessionTab {
    // The service's answer is authoritative: remember the session even before
    // its change event arrives, so detaching lists it under Resume at once. A
    // list requested before this answer is older, so it is dropped.
    this.entriesGeneration += 1;
    this.entries = [
      entry,
      ...(this.entries ?? []).filter((known) => known.sessionId !== entry.sessionId),
    ].sort((a, b) => b.lastActiveAt - a.lastActiveAt);
    const existing = this.sessions.findIndex((session) => session.sessionId === entry.sessionId);
    if (existing !== -1) {
      const session = this.sessions[existing]!;
      if (session.updateEntry(entry)) void session.attach(true, true);
      this.focusTab(existing);
      return session;
    }
    const session = new ShellSessionTab(this.shell, entry, this.sessionSize(), this.sessionEvents());
    this.sessions.push(session);
    this.listedTabs.add(session);
    this.focusTab(this.sessions.length - 1);
    void session.attach(true, true).then(() => this.changed());
    this.changed();
    return session;
  }

  /** Resume a session from the launcher; one that is not running is started again. */
  private async resume(entry: TerminalSessionEntry): Promise<void> {
    if (entry.running && entry.shellSessionId) {
      this.openTab(entry);
      return;
    }
    await this.relaunch(entry.sessionId, entry.title);
  }

  private async relaunch(sessionId: string, title: string): Promise<void> {
    this.setNotice(`Starting ${title} again…`);
    const size = this.sessionSize();
    try {
      const entry = await this.services.sessions.resume({
        sessionId,
        cols: size.columns,
        rows: size.rows,
        approvalsKey: approvalsKeyLabel(this.settings.prefixKey),
      });
      if (this.finished) return;
      this.openTab(entry);
      this.setNotice(null);
    } catch (error) {
      this.reportLaunchFailure(title, error);
    }
  }

  /** Start a terminal app, or the person's login shell (`null`). */
  private async launch(app: TerminalApp | null): Promise<void> {
    const title = app?.title ?? "Shell";
    this.setNotice(`Starting ${title}…`);
    const size = this.sessionSize();
    try {
      const entry = await this.services.sessions.launch({
        ...(app ? { source: app.source } : {}),
        cols: size.columns,
        rows: size.rows,
        approvalsKey: approvalsKeyLabel(this.settings.prefixKey),
      });
      if (this.finished) return;
      this.openTab(entry);
      this.setNotice(null);
    } catch (error) {
      this.reportLaunchFailure(title, error);
    }
  }

  private reportLaunchFailure(title: string, error: unknown): void {
    const message = `Could not start ${title}: ${describeError(error)}`;
    this.log("error", message);
    this.setNotice(`${message} (details: ${this.prefix()} l)`);
  }

  /** `prefix r`: reattach; a session whose program ended is started again. */
  private async reattach(session: ShellSessionTab): Promise<void> {
    if (session.status.kind === "exited" || !session.entry.shellSessionId) {
      await this.relaunch(session.sessionId, session.title);
      return;
    }
    await session.attach(session === this.focusedSession(), true);
  }

  private focusTab(index: number): void {
    if (index < 0 || index >= this.sessions.length) return;
    if (index === this.focusedIndex) return;
    this.focusedSession()?.setFocused(false);
    this.previousFocusedIndex = this.focusedIndex;
    this.focusedIndex = index;
    this.copy = null;
    if (
      this.overlay?.kind === "launcher" ||
      this.overlay?.kind === "palette" ||
      this.overlay?.kind === "links"
    ) {
      this.overlay = null;
    }
    const session = this.sessions[index]!;
    session.setFocused(true);
    if (!this.overlay && this.settings.autoOpenApprovals) {
      const pendingIndex = this.approvals.findIndex((approval) =>
        approvalRequestedBy(approval, session.entry.principalId)
      );
      if (pendingIndex !== -1)
        this.openApprovals(pendingIndex, `requested by ${session.title} (this tab)`);
    }
    this.compositor.invalidate();
    this.changed();
  }

  private removeTab(session: ShellSessionTab): void {
    const index = this.sessions.indexOf(session);
    if (index === -1) return;
    session.dispose();
    this.sessions.splice(index, 1);
    if (session.title !== session.entry.title) this.programTitles.set(session.sessionId, session.title);
    else this.programTitles.delete(session.sessionId);
    if (this.overlay?.kind === "confirm-close" && this.overlay.sessionId === session.sessionId) {
      this.overlay = null;
    }
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

  private detachTab(session: ShellSessionTab): void {
    this.removeTab(session);
    this.setNotice(
      session.entry.running
        ? `Detached ${session.title}; it keeps running · resume it from the launcher (${this.prefix()} c)`
        : `Closed the tab of ${session.title} · it stays in the launcher (${this.prefix()} c)`
    );
  }

  private async closeSession(sessionId: string): Promise<void> {
    const session = this.sessions.find((candidate) => candidate.sessionId === sessionId);
    if (!session) return;
    try {
      await this.services.sessions.close(sessionId);
    } catch (error) {
      this.log("error", `Could not end ${session.title}: ${describeError(error)}`);
      this.setNotice(`Could not end ${session.title}: ${describeError(error)}`);
      return;
    }
    this.removeTab(session);
    this.entries = (this.entries ?? []).filter((entry) => entry.sessionId !== sessionId);
    this.programTitles.delete(sessionId);
    this.setNotice(`Ended ${session.title}`);
  }

  private onBell(session: ShellSessionTab): void {
    // The focused tab's bell reaches the real terminal, as in any terminal;
    // a background tab's only when the person asked for that.
    if (session === this.focusedSession() || this.settings.bell) this.terminal.write("\x07");
  }

  // ── links & clipboard ──────────────────────────────────────────────────────

  private openLinks(session: ShellSessionTab): void {
    const urls = session.grid.links();
    if (urls.length === 0) {
      this.setNotice(`${session.title} has not shown any links (programs mark them with OSC 8)`);
      return;
    }
    this.copy = null;
    this.overlay = { kind: "links", tabTitle: session.title, urls, query: "", selected: 0 };
  }

  private async openUrl(url: string): Promise<void> {
    try {
      await this.host.openExternal(url);
      this.setNotice(`Opened ${new URL(url).host} in your browser`);
    } catch (error) {
      this.log("error", `Could not open ${url}: ${describeError(error)}`);
      this.setNotice(`Could not open the link: ${describeError(error)}`);
    }
  }

  /** Put text on the person's clipboard through their terminal (OSC 52). */
  private copyToClipboard(text: string): void {
    this.terminal.write(`\x1b]52;c;${Buffer.from(text, "utf8").toString("base64")}\x07`);
  }

  // ── copy mode ──────────────────────────────────────────────────────────────

  private enterCopy(session: ShellSessionTab): void {
    const grid = session.grid;
    const cursor = grid.cursor();
    this.copy = {
      sessionId: session.sessionId,
      top: grid.liveTop(),
      cursor: { x: Math.min(cursor.x, grid.columns - 1), y: grid.liveTop() + cursor.y },
      anchor: null,
    };
  }

  private scrollCopy(session: ShellSessionTab, delta: number): void {
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
        this.copyToClipboard(text);
        this.copy = null;
        this.setNotice(`Copied ${characters(text)} to your clipboard (if your terminal allows OSC 52)`);
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

function selectedText(grid: ShellSessionTab["grid"], copy: CopyState): string {
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

/** Rows a line takes when word-wrapped greedily at `width` (as Ink wraps text). */
function wrappedRows(line: string, width: number): number {
  let rows = 1;
  let used = 0;
  for (const word of line.split(" ")) {
    const length = [...word].length;
    const needed = used === 0 ? length : used + 1 + length;
    if (needed <= width) used = needed;
    else {
      rows += used === 0 ? 0 : 1;
      rows += Math.max(0, Math.ceil(length / width) - 1);
      used = length % width || Math.min(length, width);
    }
  }
  return rows;
}

function characters(text: string): string {
  const count = [...text].length;
  return `${count} character${count === 1 ? "" : "s"}`;
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
