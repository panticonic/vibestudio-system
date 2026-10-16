import React from "react";
import { withRpcAbortSignal, isRpcAbortedBy } from "@vibestudio/rpc";
import { Box, Text } from "ink";
import type { PendingApproval } from "@vibestudio/shared/approvals";
import type { DurableObservation } from "@vibestudio/shell-core/durableObservation";
import type {
  TerminalBrowserExit,
  TerminalBrowserHost,
  TerminalBrowserWorkspace,
  TerminalServerConnectionState,
} from "@vibestudio/shell-core/terminal/terminalBrowserHost";
import { createApprovalsClient, type ApprovalsClient } from "./approvals/approvalsClient.js";
import {
  ApprovalsOverlay,
  approvalHeadline,
  approvalQueueIndexAt,
} from "./approvals/ApprovalsOverlay.js";
import { approvalRequestedBy } from "./approvals/approvalRequester.js";
import { installReviewOutcomeLines } from "./approvals/installReviewOutcome.js";
import {
  editProtectedInput,
  isProtectedApproval,
  newProtectedInput,
  type ProtectedInputState,
} from "./approvals/protectedInput.js";
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
  DEFAULT_PREFIX_KEY,
  KeyRouter,
  type Binding,
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
  NeedsYouBar,
  OpenUrlDialog,
  PrefixMenu,
  SettingsOverlay,
  listItemAt,
  listWindow,
  prefixMenuBindingAt,
  settingsAt,
  StatusBar,
  TabStrip,
  prefixMenuLines,
  tabWindow,
  type ListItem,
  type LogLine,
  type StatusView,
  type TabView,
} from "./ui/chrome.js";
import { ClickRegions, ClickRegionsProvider, type ClickAction } from "./ui/clickable.js";
import { clampScroll } from "./ui/Scrollable.js";
import { Scrollable } from "./ui/Scrollable.js";

const MIN_COLUMNS = 40;
// Eight body rows keep an approval's title, queue, detail and decision hints visible.
const MIN_ROWS = 10;
const MAX_LOG_LINES = 1000;

interface ListState {
  query: string;
  selected: number;
}

type Overlay =
  | ({ kind: "palette" } & ListState)
  | ({ kind: "launcher" } & ListState)
  | ({ kind: "search"; sessionId: string } & ListState)
  | ({ kind: "log-search" } & ListState)
  | {
      kind: "approvals";
      approvalId: string | null;
      scroll: number;
      contentHeight: number;
      nav: InstallReviewNavState;
      taskRules: TaskRulesNavState;
      protectedInput: ProtectedInputState;
      origin?: string;
      /**
       * Presented by itself, so keys typed for something else must not decide
       * it: only looking around and Esc work until the person clicks into it
       * or asks for it with the prefix.
       */
      locked: boolean;
    }
  | { kind: "help"; scroll: number; contentHeight: number }
  | { kind: "logs"; scroll: number }
  | {
      kind: "detail";
      title: string;
      text: string;
      scroll: number;
      contentHeight: number;
    }
  | ({
      kind: "file";
      title: string;
      labels: string[];
      submitLabel: string;
      paths: string[];
      stage: number;
      pending: boolean;
      error: string | null;
      scroll: number;
      contentHeight: number;
      controller: AbortController;
      submit: (paths: string[], signal: AbortSignal) => Promise<string>;
    } & ListState)
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
  /** The "Needs you" bar, while the focused tab's work waits on an approval. */
  needsYou: Rect | null;
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
  private readonly lifetime = new AbortController();
  private readonly ownedTasks = new Set<Promise<unknown>>();
  private readonly retirementFailures: unknown[] = [];
  private settingsRevision = 0;
  private settingsLoaded = false;
  private settingsWrites: Promise<void> = Promise.resolve();
  private readonly tokenizer = new InputTokenizer();
  private readonly router: KeyRouter;
  private readonly services: TerminalBrowserServices;
  private readonly shell: ShellClient;
  private readonly approvalsClient: ApprovalsClient;
  private readonly compositor: Compositor;
  private readonly tabsLayer: InkLayer;
  private readonly statusLayer: InkLayer;
  private readonly needsYouLayer: InkLayer;
  /** Whether sessions are currently sized around the "Needs you" bar. */
  private needsYouShown = false;
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
  /** The launcher, with nothing open, saw one Ctrl-C; the next one quits. */
  private quitArmed = false;
  private approvalObservation: DurableObservation | null = null;
  private overlay: Overlay | null = null;
  private launcher: ListState = { query: "", selected: 0 };
  private copy: CopyState | null = null;
  private lastSearch = "";
  private notice: string | null = null;
  /** Requests already shown by themselves: each is presented once. */
  private readonly presented = new Set<string>();
  private readonly logs: LogLine[] = [];
  private connection: TerminalServerConnectionState;
  private overlayVisible = false;
  private overlayRect: Rect = { x: 0, y: 0, width: 1, height: 1 };
  /** What a click on the painted overlay means, from the geometry it was painted with. */
  private overlayClick: OverlayHitTest | null = null;
  /** The overlay's buttons and rows, located with the layout Ink drew them with. */
  private readonly overlayRegions = new ClickRegions();
  /** A confirm button the left button went down on; it acts if released there. */
  private pressedRegion: string | null = null;
  private chromeScheduled = false;
  private finished = false;
  private settle!: {
    resolve: (exit: TerminalBrowserExit) => void;
    reject: (error: unknown) => void;
  };
  private readonly cleanups: Array<() => void | Promise<void>> = [];
  private console: CapturedConsole | null = null;

  constructor(
    private readonly host: TerminalBrowserHost,
    services?: TerminalBrowserServices
  ) {
    this.terminal = new TerminalOwnership({
      stdin: host.stdin,
      stdout: host.stdout,
    });
    this.router = new KeyRouter(this.settings.prefixKey);
    // Settings live in System (the browser's app principal); the workspace it
    // shows owns the apps, the person's sessions and their approvals, reached
    // as this device's session there.
    this.services = services ?? {
      sessions: createTerminalSessions(withRpcAbortSignal(host.workspaceRpc, this.lifetime.signal)),
      settings: createTerminalSessions(withRpcAbortSignal(host.rpc, this.lifetime.signal)),
    };
    this.shell = shellClient(withRpcAbortSignal(host.workspaceRpc, this.lifetime.signal));
    this.approvalsClient = createApprovalsClient(
      withRpcAbortSignal(host.workspaceRpc, this.lifetime.signal)
    );
    this.connection = host.connectionState();
    const layout = this.layout();
    const onLayerFrame = () => this.compositor.invalidate();
    this.tabsLayer = new InkLayer({ columns: layout.columns, rows: 1 }, onLayerFrame);
    this.statusLayer = new InkLayer({ columns: layout.columns, rows: 1 }, onLayerFrame);
    this.needsYouLayer = new InkLayer({ columns: layout.columns, rows: 1 }, onLayerFrame);
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
      if (this.finished) return done;
      this.renderChrome();
      void this.own(this.load()).catch((error) => this.fail(error));
    } catch (error) {
      this.fail(error);
    }
    return done;
  }

  // ── lifecycle ──────────────────────────────────────────────────────────────

  private listen(): void {
    const { stdin, stdout } = this.host;
    const cancel = () => this.finish({ kind: "quit" }, this.host.signal.reason);
    this.host.signal.addEventListener("abort", cancel, { once: true });
    this.cleanups.push(() => this.host.signal.removeEventListener("abort", cancel));
    if (this.host.signal.aborted) {
      cancel();
      return;
    }
    const onData = (chunk: Buffer | string) => this.guard(() => this.onInput(chunk));
    stdin.on("data", onData);
    this.cleanups.push(() => {
      stdin.off("data", onData);
    });

    const onResize = () => this.guard(() => this.onResize());
    stdout.on("resize", onResize);
    this.cleanups.push(() => {
      stdout.off("resize", onResize);
    });

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
      this.cleanups.push(() => {
        process.off(signal, onSignal);
      });
    }
    process.on("SIGCONT", onContinue);
    this.cleanups.push(() => {
      process.off("SIGCONT", onContinue);
    });

    const approvalObservation = this.approvalsClient.observe(
      (pending) => this.guard(() => this.applyApprovals(pending)),
      (error) => this.log("warn", `Approval queue observation failed: ${describeError(error)}`)
    );
    this.approvalObservation = approvalObservation;
    this.cleanups.push(() => {
      if (this.approvalObservation === approvalObservation) this.approvalObservation = null;
      return approvalObservation.stop(this.lifetime.signal.reason);
    });
    this.cleanups.push(
      this.services.sessions.onChange((entries) => this.guard(() => this.applyEntries(entries)))
    );
    this.cleanups.push(
      onTerminalAppsChanged(withRpcAbortSignal(this.host.workspaceRpc, this.lifetime.signal), () =>
        this.guard(() => void this.own(this.refreshApps()))
      )
    );
  }

  private async load(): Promise<void> {
    const revision = this.settingsRevision;
    const settings = this.services.settings
      .getSettings()
      .then(
        (raw) => {
          if (revision === this.settingsRevision && !this.finished)
            this.applySettings(parseSettings(raw), false);
          if (raw["prefixKey"] === "C-g" && !this.finished)
            this.setNotice(
              `Ctrl-G is reserved for browser cancellation; your prefix is now ${prefixLabel(DEFAULT_PREFIX_KEY)}. Choose another in Settings.`
            );
        },
        (error: unknown) => {
          if (this.cancelled(error)) return;
          this.log("warn", `Settings could not be loaded; using defaults: ${describeError(error)}`);
        }
      )
      .finally(() => {
        this.settingsLoaded = true;
        this.changed();
      });
    const sessions = this.refreshSessions();
    const apps = this.refreshApps();
    await Promise.all([settings, sessions, apps, this.refreshApprovals()]);
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
    this.lifetime.abort(error ?? new Error("Terminal browser closed"));
    this.compositor.stop();
    const tasks = [
      ...this.cleanups
        .splice(0)
        .reverse()
        .map((cleanup) => Promise.resolve().then(cleanup)),
      ...this.sessions.map((session) => session.dispose()),
      ...this.ownedTasks,
      this.tabsLayer.settled(),
      this.statusLayer.settled(),
      this.needsYouLayer.settled(),
      this.overlayLayer.settled(),
    ];
    this.sessions = [];
    void (async () => {
      const results = await Promise.allSettled(tasks);
      const failures = [
        ...(error === undefined ? [] : [error]),
        ...this.retirementFailures,
        ...results.flatMap((result) =>
          result.status === "rejected" &&
          !isRpcAbortedBy(result.reason, this.lifetime.signal.reason)
            ? [result.reason]
            : []
        ),
      ];
      for (const retire of [
        () => this.tabsLayer.dispose(),
        () => this.statusLayer.dispose(),
        () => this.needsYouLayer.dispose(),
        () => this.overlayLayer.dispose(),
        () => this.terminal.release(),
        () => this.console?.restore(),
      ]) {
        try {
          retire();
        } catch (cause) {
          failures.push(cause);
        }
      }
      const unique = [...new Set(failures)];
      if (unique.length)
        this.settle.reject(
          unique.length === 1
            ? unique[0]
            : new AggregateError(unique, "Terminal browser retirement failed")
        );
      else this.settle.resolve(exit);
    })();
  }

  private own<T>(task: Promise<T>): Promise<T> {
    this.ownedTasks.add(task);
    void task.then(
      () => this.ownedTasks.delete(task),
      (error) => {
        this.ownedTasks.delete(task);
        if (!isRpcAbortedBy(error, this.lifetime.signal.reason))
          this.retirementFailures.push(error);
      }
    );
    return task;
  }

  /** Only this owner's exact cancellation is normal; failed joins retain their cause. */
  private cancelled(error: unknown): boolean {
    if (!this.lifetime.signal.aborted) return false;
    if (isRpcAbortedBy(error, this.lifetime.signal.reason)) return true;
    throw error;
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
        if (session.entry.running && session.entry.shellSessionId) {
          void this.own(session.attach(this.sessions[this.focusedIndex] === session, false));
        }
      }
      void this.own(this.refreshApprovals());
      void this.own(this.refreshSessions());
    } else if (state.phase === "reconnecting") {
      for (const session of this.sessions) void this.own(session.detach());
      this.log("warn", `Connection interrupted: ${state.cause}`);
    }
    this.changed();
  }

  private onResize(): void {
    this.router.setPrefix(this.settings.prefixKey);
    this.copy = null;
    this.relayout(this.layout());
    this.changed();
  }

  /** Fit sessions and chrome layers to `layout` (a resize, or the bar coming or going). */
  private relayout(layout: Layout): void {
    this.needsYouShown = layout.needsYou !== null;
    for (const session of this.sessions) session.resize(this.sessionSize(layout));
    this.tabsLayer.resize({ columns: layout.columns, rows: 1 });
    this.needsYouLayer.resize({ columns: layout.columns, rows: 1 });
    this.statusLayer.resize({ columns: layout.columns, rows: 1 });
    this.compositor.invalidateAll();
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
      if (this.cancelled(error)) return;
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
        void this.own(session.attach(session === this.focusedSession(), true));
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
      this.apps = await listTerminalApps(
        withRpcAbortSignal(this.host.workspaceRpc, this.lifetime.signal)
      );
      this.appsProblem = null;
    } catch (error) {
      if (this.cancelled(error)) return;
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
      if (this.cancelled(error)) return;
      this.log("warn", `Approvals could not be refreshed: ${describeError(error)}`);
    }
  }

  private applyApprovals(pending: PendingApproval[]): void {
    if (this.finished) return;
    const previous = this.approvals;
    const emptied = previous.length > 0 && pending.length === 0;
    this.approvals = pending;
    if (this.overlay?.kind === "approvals") {
      const overlay = this.overlay;
      // The queue was worked through: get out of the way. (Opened empty: stay, it says so.)
      if (emptied) {
        overlay.protectedInput = newProtectedInput();
        this.overlay = null;
      } else if (!pending.some((approval) => approval.approvalId === overlay.approvalId)) {
        // Removal never transfers consent to a different request. Selecting a
        // replacement belongs to explicit navigation, not queue reordering.
        overlay.approvalId = null;
        overlay.scroll = 0;
        overlay.nav = INITIAL_INSTALL_REVIEW_NAV;
        overlay.taskRules = INITIAL_TASK_RULES_NAV;
        overlay.protectedInput = newProtectedInput();
      }
    }
    this.changed();
  }

  /**
   * Show each request once, in full, as it arrives: over the tab or the
   * launcher, but never over a dialog the person is in the middle of (it
   * waits for that to close). After Esc it lives in the Needs-you bar and the
   * status bar.
   */
  private presentArrivals(): void {
    const current = new Set(this.approvals.map((approval) => approval.approvalId));
    for (const id of this.presented) if (!current.has(id)) this.presented.delete(id);
    const shown =
      this.overlay?.kind === "approvals" || !this.settings.autoOpenApprovals || this.copy !== null;
    const covers =
      !this.overlay || (this.overlay.kind === "launcher" && this.sessions.length === 0);
    if (!shown) {
      if (!covers) return;
      const index = this.approvals.findIndex(
        (approval) => !this.presented.has(approval.approvalId)
      );
      if (index === -1) return;
      if (this.overlay?.kind === "launcher")
        this.launcher = { query: this.overlay.query, selected: this.overlay.selected };
      const focused = this.focusedSession();
      const own = focused
        ? this.approvals.findIndex(
            (approval) =>
              !this.presented.has(approval.approvalId) &&
              approvalRequestedBy(approval, focused.entry.principalId)
          )
        : -1;
      const selected = own === -1 ? index : own;
      const requester = this.sessions.find((session) =>
        approvalRequestedBy(this.approvals[selected]!, session.entry.principalId)
      );
      this.openApprovals(
        selected,
        requester
          ? `requested by ${requester.title}${requester === focused ? " (this tab)" : ""}`
          : undefined,
        true
      );
    }
    for (const id of current) this.presented.add(id);
  }

  // ── layout & composition ───────────────────────────────────────────────────

  private layout(): Layout {
    const columns = Math.max(1, this.host.stdout.columns ?? 80);
    const rows = Math.max(1, this.host.stdout.rows ?? 24);
    const tooSmall = columns < MIN_COLUMNS || rows < MIN_ROWS;
    const bar = !tooSmall && this.tabApprovals().length > 0 ? 1 : 0;
    return {
      columns,
      rows,
      tooSmall,
      tabs: { x: 0, y: 0, width: columns, height: 1 },
      body: { x: 0, y: 1, width: columns, height: Math.max(1, rows - 2 - bar) },
      needsYou: bar ? { x: 0, y: rows - 2, width: columns, height: 1 } : null,
      status: { x: 0, y: rows - 1, width: columns, height: 1 },
    };
  }

  /** Pending approvals the focused tab's work raised or is waiting on: the bar's subject. */
  private tabApprovals(): PendingApproval[] {
    const session = this.focusedSession();
    return session
      ? this.approvals.filter((approval) =>
          approvalRequestedBy(approval, session.entry.principalId)
        )
      : [];
  }

  private sessionSize(layout = this.layout()): {
    columns: number;
    rows: number;
  } {
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
    if (layout.needsYou) this.needsYouLayer.grid.paint(screen, layout.needsYou);
    this.statusLayer.grid.paint(screen, layout.status);
    if (!session || this.overlayVisible || this.copy || !session.isLive()) return hidden;
    const cursor = session.grid.cursor();
    if (!cursor.visible || cursor.x >= layout.body.width || cursor.y >= layout.body.height)
      return hidden;
    return {
      x: layout.body.x + cursor.x,
      y: layout.body.y + cursor.y,
      visible: true,
    };
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
    this.presentArrivals();
    const layout = this.layout();
    this.tabsLayer.update(
      <TabStrip
        tabs={this.tabViews()}
        width={layout.columns}
        brand={`Vibestudio · ${this.host.workspace.name}`}
      />
    );
    this.statusLayer.update(<StatusBar view={this.statusView()} width={layout.columns} />);
    // The bar takes a row from the tab while it shows: sessions resize with it.
    if ((layout.needsYou !== null) !== this.needsYouShown) this.relayout(layout);
    const waiting = this.tabApprovals();
    if (layout.needsYou && waiting.length > 0)
      this.needsYouLayer.update(
        <NeedsYouBar
          headline={approvalHeadline(waiting[0]!)}
          more={waiting.length - 1}
          prefixLabel={this.prefix()}
          width={layout.columns}
        />
      );
    const overlay = this.overlayElement(layout);
    this.overlayVisible = overlay !== null;
    this.overlayClick = overlay?.click ?? null;
    if (overlay) {
      this.overlayRect = overlay.rect;
      this.overlayLayer.resize({
        columns: overlay.rect.width,
        rows: overlay.rect.height,
      });
      this.overlayLayer.update(
        <ClickRegionsProvider regions={this.overlayRegions}>{overlay.element}</ClickRegionsProvider>
      );
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
        status: session.entry.failure
          ? "problem"
          : kind === "live" || kind === "attaching"
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
      // While the "Needs you" bar names the tab's approval, the pill only counts.
      ...(this.approvals.length > 0 && this.tabApprovals().length === 0
        ? {
            approvalHeadline: approvalHeadline(this.approvals[this.firstApprovalIndex()]!),
          }
        : {}),
      prefixLabel: prefix,
      prefixPending: this.router.pending,
      ...(hint ? { hint } : {}),
      notice: this.notice ?? this.focusedSession()?.entry.failure ?? null,
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

  private overlayElement(layout: Layout): {
    rect: Rect;
    element: React.ReactElement;
    click?: OverlayHitTest;
  } | null {
    const overlay = this.overlay;
    const body = layout.body;
    const prefix = this.prefix();
    if (this.router.pending) {
      // The armed prefix shows every command it can run, in full, over the
      // bottom of the screen and whatever is open there; the next key picks
      // one or cancels, and what was open comes back.
      const lines = prefixMenuLines(prefix, body.width, body.height - 2);
      const height = Math.min(lines.length + 2, body.height);
      return {
        rect: {
          x: body.x,
          y: body.y + body.height - height,
          width: body.width,
          height,
        },
        element: <PrefixMenu lines={lines} width={body.width} height={height} />,
        click: (x, y) => {
          const binding = prefixMenuBindingAt(lines, height, x, y);
          return binding ? { key: bindingKeyName(binding) } : null;
        },
      };
    }
    if (!overlay) {
      const session = this.focusedSession();
      if (!session || session.isLive() || this.copy) return null;
      const message = this.sessionMessage(session);
      const width = Math.min(76, body.width - 4);
      // Border and title, plus every line as it wraps inside the border and padding.
      const textWidth = Math.max(1, width - 4);
      const wrapped = message.lines.reduce((rows, line) => rows + wrappedRows(line, textWidth), 0);
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
      return {
        rect,
        element: <MessageBox {...message} width={rect.width} height={rect.height} />,
      };
    }
    switch (overlay.kind) {
      case "log-search": {
        const rect = body;
        const logs = this.logs.filter((line) =>
          line.message.toLocaleLowerCase().includes(overlay.query.toLocaleLowerCase())
        );
        overlay.selected = Math.min(overlay.selected, Math.max(0, logs.length - 1));
        const items = logs.map((line, index) => ({
          key: String(index),
          label: `${line.level.toUpperCase()} ${line.message}`,
          detail: new Date(line.time).toISOString(),
        }));
        return {
          rect,
          element: (
            <ListOverlay
              title="Inspect browser log entries"
              query={overlay.query}
              placeholder="filter messages"
              items={items}
              selected={overlay.selected}
              width={rect.width}
              height={rect.height}
              empty={<Text dimColor>No matching log entries.</Text>}
              footer="↑↓ entry · Enter full detail · Ctrl-G close"
            />
          ),
          click: listClick(items, overlay.selected, rect.height),
        };
      }
      case "file": {
        const rect = this.centered(layout, Math.min(90, body.width), Math.min(12, body.height));
        return {
          rect,
          element: (
            <Box height={rect.height} flexDirection="column" borderStyle="round" paddingX={1}>
              <Text bold>{overlay.title}</Text>
              <Scrollable
                height={Math.max(1, rect.height - 4)}
                scroll={overlay.scroll}
                onContentHeight={(height) => {
                  overlay.contentHeight = height;
                }}
              >
                <Text>
                  {[
                    ...overlay.paths.map((path, index) => `${overlay.labels[index]}: ${path}`),
                    ...(overlay.stage < overlay.labels.length
                      ? [`${overlay.labels[overlay.stage]}: ${overlay.query}`]
                      : [overlay.submitLabel]),
                    overlay.pending
                      ? "Working… Ctrl-G cancels and joins this operation."
                      : "Local output files are never overwritten.",
                    ...(overlay.error ? [overlay.error] : []),
                  ].join("\n")}
                </Text>
              </Scrollable>
              <Text>
                {overlay.pending
                  ? "Ctrl-G cancel and join"
                  : overlay.stage < overlay.labels.length
                    ? "Enter next · Shift-Tab back · PgUp/PgDn scroll · Ctrl-G cancel"
                    : `Enter: ${overlay.submitLabel} · Shift-Tab edit · Ctrl-G cancel`}
              </Text>
            </Box>
          ),
        };
      }
      case "detail": {
        const rect = body;
        return {
          rect,
          element: (
            <Box borderStyle="round" paddingX={1} height={rect.height} flexDirection="column">
              <Text bold>{overlay.title}</Text>
              <Scrollable
                height={Math.max(1, rect.height - 4)}
                scroll={overlay.scroll}
                onContentHeight={(height) => {
                  overlay.contentHeight = height;
                }}
              >
                <Text>{overlay.text}</Text>
              </Scrollable>
              <Text dimColor>↑↓/PgUp/PgDn scroll · c copy · e save to file · Ctrl-G close</Text>
            </Box>
          ),
        };
      }
      case "search": {
        const rect = this.centered(layout, Math.min(90, body.width), body.height);
        const session = this.sessions.find((tab) => tab.sessionId === overlay.sessionId);
        const matches = session?.grid.search(overlay.query) ?? [];
        overlay.selected = Math.min(overlay.selected, Math.max(0, matches.length - 1));
        const items = matches.map((match, index) => ({
          key: String(index),
          label: `${match.start.y + 1}: ${match.text}`,
        }));
        return {
          rect,
          element: (
            <ListOverlay
              title={`Search scrollback · ${session?.title ?? "tab ended"}`}
              query={overlay.query}
              placeholder="literal, case-sensitive search"
              items={items}
              selected={overlay.selected}
              width={rect.width}
              height={rect.height}
              empty={
                <Text dimColor>
                  {overlay.query ? "No matching retained rows." : "Type to search scrollback."}
                </Text>
              }
              footer="↑↓ match · Enter inspect/select · Ctrl-G close · n/N repeat in copy mode"
            />
          ),
          click: listClick(items, overlay.selected, rect.height),
        };
      }
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
          click: listClick(items, overlay.selected, rect.height),
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
          click: listClick(items, overlay.selected, rect.height),
        };
      }
      case "approvals":
        return {
          rect: body,
          element: (
            <ApprovalsOverlay
              pending={this.approvals}
              selectedIndex={this.approvalIndex(overlay)}
              {...this.installReviewProps(overlay)}
              protectedInput={overlay.protectedInput}
              height={body.height}
              detailScroll={overlay.scroll}
              onDetailHeight={(rows) => {
                if (this.overlay === overlay && overlay.contentHeight !== rows) {
                  overlay.contentHeight = rows;
                }
              }}
              {...(overlay.origin ? { origin: overlay.origin } : {})}
              locked={overlay.locked}
              prefixLabel={prefix}
            />
          ),
          // A click on the queue selects a request; buttons decide.
          click: ((count, selected) => (_x: number, y: number) => {
            const index = approvalQueueIndexAt(count, selected, body.height, y);
            return index === null ? null : { select: index };
          })(this.approvals.length, this.approvalIndex(overlay)),
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
              loading={!this.settingsLoaded}
            />
          ),
          click: ((settings) => (x: number, y: number) => {
            const hit = settingsAt(settings, rect.width, x, y);
            if (!hit) return null;
            return hit.step === 0
              ? { select: hit.index }
              : { select: hit.index, key: hit.step < 0 ? "left" : "right" };
          })(this.settings),
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
          click: listClick(items, overlay.selected, rect.height),
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
              ]}
              buttons={[
                {
                  id: "end",
                  label: "[y] End it",
                  action: { key: "y", confirm: true },
                  color: "red",
                },
                {
                  id: "keep",
                  label: "[Esc] Keep it",
                  action: { key: "escape" },
                },
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
          click: listClick(items, overlay.selected, rect.height),
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
        return {
          title: `Attaching to ${session.title}…`,
          lines: [],
          tone: "info",
        };
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
        return {
          title: session.title,
          lines: session.entry.failure
            ? [
                session.entry.failure,
                "The known program remains running; its session observation failed.",
                `${prefix} r refresh the attachment`,
              ]
            : ["Running and attached."],
          tone: session.entry.failure ? "warn" : "info",
        };
    }
  }

  private installReviewProps(overlay: Extract<Overlay, { kind: "approvals" }>) {
    const current = this.approvals[this.approvalIndex(overlay)];
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
        detail: `${this.kindLabel(entry)} · ${state}${entry.failure ? ` · ${entry.failure}` : ""} · active ${relativeTime(entry.lastActiveAt)}`,
        hint: entry.running ? "running" : "restart",
        run: () => void this.own(this.resume(entry)),
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
      run: () => void this.own(this.launch(null)),
    });
    for (const app of this.apps ?? []) {
      entries.push({
        key: `start:${app.source}`,
        section: "Start",
        label: `${app.icon ? `${app.icon} ` : ""}${app.title}`,
        detail: app.description ?? app.source,
        hint: "new",
        run: () => void this.own(this.launch(app)),
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
        detail:
          "Programs in terminal-apps/<name> appear here once built. Ask an agent to “make a terminal app that …”.",
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
      action("search", "Search terminal scrollback", () => this.openSearch(focused));
      action("session-details", "Inspect full session status/error", () => {
        const message = this.sessionMessage(focused);
        this.openDetail(message.title, message.lines.join("\n"));
      });
      action("export-scrollback", "Save retained terminal output to a local file", () =>
        this.saveTextPrompt(`Export ${focused.title}`, focused.grid.retainedText())
      );
      if (focused.entry.contextId) {
        const contextId = focused.entry.contextId;
        action("upload", "Upload a local file to this session context", () =>
          this.filePrompt(
            `Upload file · ${focused.title} · ${this.host.workspace.name}`,
            ["Local source path", "Workspace destination path"],
            "Upload and replace workspace destination",
            async ([localPath, workspacePath], signal) => {
              const result = await this.host.files.upload(
                {
                  contextId,
                  localPath: localPath!,
                  workspacePath: workspacePath!,
                },
                { signal }
              );
              return `Uploaded ${result.path} (${result.size} bytes). Use /attach ${result.path} in chat.`;
            }
          )
        );
        action("download", "Download a workspace file to this computer", () =>
          this.filePrompt(
            `Download file · ${focused.title} · ${this.host.workspace.name}`,
            ["Workspace source path", "Local destination path"],
            "Download to a new local file",
            async ([workspacePath, localPath], signal) => {
              const result = await this.host.files.download(
                {
                  contextId,
                  workspacePath: workspacePath!,
                  localPath: localPath!,
                },
                { signal }
              );
              return `Saved ${result.path} (${result.size} bytes)`;
            }
          )
        );
      }
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
    action("log-search", "Search and inspect browser log entries", () => {
      this.overlay = { kind: "log-search", query: "", selected: 0 };
    });
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
    if (this.layout().tooSmall) {
      // Nothing hidden may accept input or consent. The explicit quit command
      // remains available while the terminal cannot display a usable frame.
      for (const routed of this.router.route(events)) {
        if (
          routed.kind === "command" &&
          (routed.command.kind === "quit" || routed.command.kind === "cancel")
        )
          this.command(routed.command);
        else if (
          routed.kind === "input" &&
          routed.event.kind === "key" &&
          (routed.event.name === "C-g" || routed.event.name === "escape")
        )
          this.command({ kind: "cancel" });
      }
      return;
    }
    this.onEvents(events);
  }

  /** Routed input: the terminal's events, and the keys a click stands for. */
  private onEvents(events: readonly InputEvent[]): void {
    let sessionData = "";
    const flush = () => {
      if (sessionData) {
        const session = this.focusedSession();
        if (session && !session.isLive())
          this.setNotice(`Input not sent: ${session.title} is ${session.status.kind}`);
        else session?.sendInput(sessionData);
      }
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
        if (event.kind === "key" && event.name === "C-g") this.command({ kind: "cancel" });
        else this.onUiInput(event);
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
    if (event.protocol === "csi-u") {
      if (session.grid.disambiguatedKeys()) return event.seq;
      const point = event.codepoint!;
      const modifiers = event.modifiers! - 1;
      let bytes = String.fromCodePoint(point);
      if (modifiers & 4) {
        if (point === 32 || point === 64) bytes = "\x00";
        else if ((point >= 65 && point <= 95) || (point >= 97 && point <= 122))
          bytes = String.fromCharCode(point & 31);
        else if (point === 63) bytes = "\x7f";
      }
      return (modifiers & 2 ? "\x1b" : "") + bytes;
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
    // A click on browser chrome is the input it stands for: it selects what
    // it lands on and sends the key that acts on it, through the same path.
    const rect = this.overlayRect;
    const onOverlay =
      this.overlayVisible &&
      event.x >= rect.x &&
      event.x < rect.x + rect.width &&
      event.y >= rect.y &&
      event.y < rect.y + rect.height;
    const hit =
      onOverlay && event.action === "press" && event.button === 0
        ? (this.overlayClick?.(event.x - rect.x, event.y - rect.y) ?? null)
        : null;
    if (this.router.pending) {
      if (event.action !== "press") return;
      if (hit?.key) this.onEvents([syntheticKey(hit.key)]);
      else {
        this.router.cancel();
        this.changed();
      }
      return;
    }
    if (this.isModalOpen()) {
      if (event.action === "wheel-up" || event.action === "wheel-down") {
        this.onUiInput(syntheticKey(event.action === "wheel-up" ? "up" : "down"));
        return;
      }
      if (event.button !== 0 || (event.action !== "press" && event.action !== "release")) return;
      const region = onOverlay ? this.overlayRegions.at(event.x - rect.x, event.y - rect.y) : null;
      // Clicking into a request presented by itself is the person engaging with it.
      if (onOverlay && event.action === "press" && this.overlay?.kind === "approvals")
        this.overlay.locked = false;
      if (event.action === "release") {
        // A decision acts only when released on the button it was pressed on.
        const pressed = this.pressedRegion;
        this.pressedRegion = null;
        if (pressed !== null && region?.id === pressed) this.applyClick(region.action);
        return;
      }
      this.pressedRegion = null;
      if (region) {
        if (region.action.confirm) this.pressedRegion = region.id;
        else this.applyClick(region.action);
        return;
      }
      if (hit) {
        if (hit.select !== undefined) this.selectInOverlay(hit.select);
        if (hit.key) this.onEvents([syntheticKey(hit.key)]);
      } else if (!onOverlay && this.dismissedByClickAway()) {
        this.onEvents([syntheticKey("escape")]);
      }
      return;
    }
    if (event.y === layout.tabs.y && event.action === "press" && this.sessions.length > 0) {
      const window = tabWindow(this.sessions.length, this.focusedIndex, layout.columns);
      if (event.x < window.inset) this.focusTab(Math.max(0, window.first - 1));
      else if (event.x >= window.inset + window.count * window.share)
        this.focusTab(Math.min(this.sessions.length - 1, window.first + window.count));
      else this.focusTab(window.first + Math.floor((event.x - window.inset) / window.share));
      return;
    }
    if (
      (event.y === layout.status.y || event.y === layout.needsYou?.y) &&
      event.action === "press" &&
      this.approvals.length > 0
    ) {
      this.command({ kind: "approvals" });
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
      const top =
        this.copy?.sessionId === session.sessionId ? this.copy.top : session.grid.liveTop();
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
      case "log-search": {
        const logs = this.logs.filter((line) =>
          line.message.toLocaleLowerCase().includes(overlay.query.toLocaleLowerCase())
        );
        const result = editList(overlay, event, logs.length);
        if (result === "cancel") this.overlay = null;
        else if (result === "accept" && logs[overlay.selected]) {
          const line = logs[overlay.selected]!;
          this.openDetail(
            `${line.level.toUpperCase()} · ${new Date(line.time).toISOString()}`,
            line.message
          );
        }
        break;
      }
      case "file": {
        if (event.kind === "key" && event.name === "escape") {
          overlay.controller.abort(new Error("File operation cancelled"));
          this.overlay = null;
          break;
        }
        if (overlay.pending) break;
        if (event.kind === "key" && (event.name === "pageup" || event.name === "pagedown")) {
          const height = Math.max(1, Math.min(12, this.layout().body.height) - 4);
          overlay.scroll = clampScroll(
            overlay.scroll + (event.name === "pageup" ? -height : height),
            overlay.contentHeight,
            height
          );
          break;
        }
        if (event.kind === "key" && event.name === "backtab" && overlay.stage > 0) {
          if (overlay.stage < overlay.labels.length) overlay.paths[overlay.stage] = overlay.query;
          overlay.stage--;
          overlay.query = overlay.paths[overlay.stage] ?? "";
          break;
        }
        const result =
          overlay.stage < overlay.labels.length
            ? editList(overlay, event, 0)
            : event.kind === "key" && event.name === "enter"
              ? "accept"
              : null;
        if (result === "accept") {
          if (overlay.stage < overlay.labels.length && !overlay.query.trim()) {
            overlay.error = "A path is required";
            break;
          }
          if (overlay.stage < overlay.labels.length) {
            overlay.paths[overlay.stage] = overlay.query;
            overlay.stage++;
            overlay.query = overlay.paths[overlay.stage] ?? "";
            overlay.error = null;
          } else {
            overlay.pending = true;
            const signal = AbortSignal.any([this.lifetime.signal, overlay.controller.signal]);
            void this.own(
              overlay.submit([...overlay.paths], signal).then(
                (notice) => {
                  if (this.overlay === overlay) this.overlay = null;
                  this.setNotice(notice);
                },
                (error) => {
                  if (signal.aborted && isRpcAbortedBy(error, signal.reason)) return;
                  if (signal.aborted) throw error;
                  overlay.pending = false;
                  overlay.error = describeError(error);
                  this.log("error", `${overlay.title}: ${overlay.error}`);
                  this.changed();
                }
              )
            );
          }
        }
        break;
      }
      case "detail": {
        if (event.kind === "key" && event.name === "c") this.copyToClipboard(overlay.text);
        else if (event.kind === "key" && event.name === "e")
          this.saveTextPrompt(overlay.title, overlay.text);
        else {
          const height = Math.max(1, this.layout().body.height - 4);
          const scroll = scrollFor(event, overlay.scroll, height);
          if (scroll === "close") this.overlay = null;
          else if (scroll !== null)
            overlay.scroll = clampScroll(scroll, overlay.contentHeight, height);
        }
        break;
      }
      case "search": {
        const session = this.sessions.find((tab) => tab.sessionId === overlay.sessionId);
        const matches = session?.grid.search(overlay.query) ?? [];
        const result = editList(overlay, event, matches.length);
        if (result === "cancel") this.overlay = null;
        else if (result === "accept" && session && matches[overlay.selected]) {
          this.lastSearch = overlay.query;
          const match = matches[overlay.selected]!;
          this.enterCopy(session);
          this.copy!.cursor = { ...match.end };
          this.copy!.anchor = { ...match.start };
          this.copy!.top = Math.min(match.start.y, session.grid.liveTop());
          this.overlay = null;
        }
        break;
      }
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
        // With nothing open the launcher is the whole browser: Ctrl-C twice
        // leaves it, the way it leaves the chat and most terminal programs.
        if (overlay.kind === "launcher" && this.sessions.length === 0) {
          const ctrlC = event.kind === "key" && event.name === "C-c";
          if (ctrlC && this.quitArmed) {
            this.finish({ kind: "quit" });
            return;
          }
          this.quitArmed = ctrlC;
          if (ctrlC) {
            this.setNotice("Press Ctrl-C again to quit · your sessions keep running");
            break;
          }
        }
        const result = editList(overlay, event, items.length);
        if (result === "cancel") {
          if (overlay.kind === "launcher" && this.sessions.length === 0) {
            this.setNotice(
              `Choose something to open, or press Ctrl-C twice (or ${this.prefix()} q) to quit`
            );
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
        if (event.kind === "key" && event.name === "/") {
          this.overlay = { kind: "log-search", query: "", selected: 0 };
          break;
        }
        if (event.kind === "key" && event.name === "enter") {
          this.openDetail("Full browser log", this.logText());
          break;
        }
        if (event.kind === "key" && event.name === "e") {
          this.saveTextPrompt("Export browser log", this.logText());
          break;
        }
        if (event.kind === "key" && event.name === "c") {
          this.copyToClipboard(this.logText());
          break;
        }
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
          void this.own(this.closeSession(overlay.sessionId));
        } else if (event.kind === "key" && (event.name === "escape" || event.name === "n")) {
          this.overlay = null;
        }
        break;
      case "open-url":
        if (event.kind === "key" && event.name === "o" && isOpenableUrl(overlay.url)) {
          this.overlay = null;
          void this.own(this.openUrl(overlay.url));
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
    const nav = event.kind === "key" ? navKeyOf(event) : null;
    const selected = this.approvalIndex(overlay);
    const target = this.approvals[selected];
    if (
      overlay.locked &&
      nav !== "up" &&
      nav !== "down" &&
      nav !== "pageup" &&
      nav !== "pagedown" &&
      nav !== "home" &&
      nav !== "end" &&
      nav !== "escape"
    ) {
      this.notice = `Not answered: click a decision, or press ${this.prefix()} a to answer with keys`;
      return;
    }
    if (isProtectedApproval(target) && event.kind === "key" && event.name === "C-d") {
      overlay.protectedInput = newProtectedInput();
      void this.own(
        this.approvalsClient
          .resolve(target.approvalId, "deny")
          .then(() => this.refreshApprovals())
          .catch((error) => this.reportApprovalFailure(error))
      );
      return;
    }
    if (
      isProtectedApproval(target) &&
      nav !== "up" &&
      nav !== "down" &&
      nav !== "pageup" &&
      nav !== "pagedown" &&
      nav !== "home" &&
      nav !== "end"
    ) {
      const result = editProtectedInput(target, overlay.protectedInput, event);
      if (result === "cancel") {
        overlay.protectedInput = newProtectedInput();
        this.overlay = null;
      }
      if (result === "submit") {
        const state = overlay.protectedInput;
        state.submitting = true;
        const submit =
          target.kind === "client-config"
            ? this.approvalsClient.submitClientConfig
            : target.kind === "credential-input"
              ? this.approvalsClient.submitCredentialInput
              : this.approvalsClient.submitSecretInput;
        void this.own(
          submit(target.approvalId, { ...state.values }).then(
            () => {
              state.values = {};
              return this.refreshApprovals();
            },
            (error: unknown) => {
              if (this.cancelled(error)) return;
              state.submitting = false;
              state.error = "Submission failed. Values remain here; retry or cancel.";
              this.changed();
            }
          )
        );
      }
      return;
    }
    if (event.kind !== "key") return;
    if (target?.kind === "device-code" && event.name === "o") {
      void this.own(this.openUrl(target.verificationUriComplete ?? target.verificationUri));
      return;
    }
    if (target?.kind === "device-code" && event.name === "c") {
      this.copyToClipboard(target.userCode);
      return;
    }
    const detailRows = Math.max(1, this.layout().body.height - 8);
    if (nav === "escape") {
      this.overlay = null;
    } else if (nav === "up" || nav === "down") {
      this.selectApproval(overlay, selected < 0 ? 0 : selected + (nav === "up" ? -1 : 1));
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
        void this.own(
          this.approvalsClient
            .resolve(route.approvalId, route.decision)
            .then(() => this.refreshApprovals())
            .catch((error: unknown) => this.reportApprovalFailure(error))
        );
      } else if (route.via === "resolveTaskRules") {
        void this.own(
          this.approvalsClient
            .resolveTaskRules(route.approvalId, route.resolution)
            .then(() => this.refreshApprovals())
            .catch((error: unknown) => this.reportApprovalFailure(error))
        );
      } else if (route.via === "resolveInstallReview") {
        void this.own(
          this.approvalsClient
            .resolveInstallReview(route.approvalId, route.resolution)
            .then((outcome) => {
              const lines = installReviewOutcomeLines(outcome);
              for (const line of lines)
                this.log(outcome.landing?.failed.length ? "warn" : "info", line);
              this.setNotice(`${outcome.heading} · ${this.prefix()} l for details`);
              this.openDetail(outcome.heading, lines.join("\n"));
              return this.refreshApprovals();
            })
            .catch((error: unknown) => this.reportApprovalFailure(error))
        );
      }
    }
  }

  private reportApprovalFailure(error: unknown): void {
    if (this.cancelled(error)) return;
    this.log("error", `Approval decision failed: ${describeError(error)}`);
    this.setNotice(`Your decision was not recorded (details: ${this.prefix()} l)`);
    // The queue may have moved on (decided elsewhere, withdrawn): show what is waiting now.
    void this.own(this.refreshApprovals());
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
      if (!this.settingsLoaded) {
        this.setNotice("Settings are still loading; your saved values must arrive before editing.");
        return;
      }
      const row = SETTING_ROWS[overlay.selected]!;
      const next = row.step(this.settings, nav === "left" ? -1 : 1);
      this.applySettings(next, true);
    }
  }

  // ── commands ───────────────────────────────────────────────────────────────

  private command(command: Command): void {
    const session = this.focusedSession();
    switch (command.kind) {
      case "cancel":
        if (this.overlay?.kind === "approvals") this.overlay.protectedInput = newProtectedInput();
        if (this.overlay?.kind === "file")
          this.overlay.controller.abort(new Error("File operation cancelled"));
        this.overlay = null;
        this.copy = null;
        break;
      case "palette":
        this.overlay = { kind: "palette", query: "", selected: 0 };
        break;
      case "launcher":
        this.overlay = { kind: "launcher", query: "", selected: 0 };
        void this.own(this.refreshApps());
        void this.own(this.refreshSessions());
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
      case "search":
        if (session) this.openSearch(session);
        break;
      case "approvals": {
        // Asked for: keys answer it, the one already showing included.
        if (this.overlay?.kind === "approvals") this.overlay.locked = false;
        else this.openApprovals(this.firstApprovalIndex());
        void this.own(this.refreshApprovals());
        break;
      }
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
        if (session)
          this.overlay = {
            kind: "confirm-close",
            sessionId: session.sessionId,
          };
        break;
      case "reattach":
        if (session) void this.own(this.reattach(session));
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

  private openApprovals(selected: number, origin?: string, locked = false): void {
    this.copy = null;
    this.overlay = {
      kind: "approvals",
      approvalId:
        this.approvals[Math.min(selected, Math.max(0, this.approvals.length - 1))]?.approvalId ??
        null,
      scroll: 0,
      contentHeight: 0,
      nav: INITIAL_INSTALL_REVIEW_NAV,
      taskRules: INITIAL_TASK_RULES_NAV,
      protectedInput: newProtectedInput(),
      ...(origin ? { origin } : {}),
      locked,
    };
  }

  /** Where approvals open, and what the status bar names: the focused tab's own, else the oldest. */
  private firstApprovalIndex(): number {
    const session = this.focusedSession();
    const own = session
      ? this.approvals.findIndex((approval) =>
          approvalRequestedBy(approval, session.entry.principalId)
        )
      : -1;
    return Math.max(0, own);
  }

  /** Show another request: its review starts fresh, and nothing typed for the last one carries over. */
  private selectApproval(overlay: Extract<Overlay, { kind: "approvals" }>, index: number): void {
    overlay.approvalId =
      this.approvals[Math.min(Math.max(0, index), this.approvals.length - 1)]?.approvalId ?? null;
    overlay.scroll = 0;
    overlay.nav = INITIAL_INSTALL_REVIEW_NAV;
    overlay.taskRules = INITIAL_TASK_RULES_NAV;
    overlay.protectedInput = newProtectedInput();
  }

  /** A clicked region: focus what it names, then press its key through the usual input path. */
  private applyClick(action: ClickAction): void {
    const overlay = this.overlay;
    if (overlay?.kind === "approvals") {
      if (action.field !== undefined && !overlay.protectedInput.submitting)
        overlay.protectedInput.field = action.field;
      if (action.part !== undefined && action.part !== overlay.nav.partIndex)
        overlay.nav = {
          ...overlay.nav,
          partIndex: action.part,
          rowExpanded: false,
          rowIndex: 0,
        };
      if (action.rule !== undefined)
        overlay.taskRules = { ...overlay.taskRules, rowIndex: action.rule };
    }
    if (action.key) this.onEvents([syntheticKey(action.key)]);
    else this.changed();
  }

  /** Move the open overlay's selection to what a click landed on. */
  private selectInOverlay(index: number): void {
    const overlay = this.overlay;
    if (!overlay) return;
    if (overlay.kind === "approvals") this.selectApproval(overlay, index);
    else if ("selected" in overlay) overlay.selected = index;
    this.changed();
  }

  /**
   * Whether a click outside the open overlay closes it, as Esc does. Not where
   * Esc does more than close: it aborts a file transfer, and in approvals it
   * clears values typed into a protected form. Not the launcher with nothing
   * open either: it is the whole screen.
   */
  private dismissedByClickAway(): boolean {
    const overlay = this.overlay;
    if (!overlay) return false;
    if (overlay.kind === "file" || overlay.kind === "approvals") return false;
    return !(overlay.kind === "launcher" && this.sessions.length === 0);
  }

  private approvalIndex(overlay: Extract<Overlay, { kind: "approvals" }>): number {
    return this.approvals.findIndex((approval) => approval.approvalId === overlay.approvalId);
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
    void this.own(
      this.host.listWorkspaces().then(
        (workspaces) => {
          overlay.workspaces = workspaces;
          this.changed();
        },
        (error: unknown) => {
          if (this.cancelled(error)) return;
          overlay.error = describeError(error);
          this.changed();
        }
      )
    );
  }

  private applySettings(next: BrowserSettings, persist: boolean): void {
    const previous = this.settings;
    this.settings = next;
    if (next.prefixKey !== previous.prefixKey) this.router.setPrefix(next.prefixKey);
    if (next.mouse !== previous.mouse) this.terminal.setMouse(next.mouse);
    if (persist) {
      const revision = ++this.settingsRevision;
      this.settingsWrites = this.settingsWrites
        .then(() => this.services.settings.setSettings({ ...next }))
        .then(
          () => {
            if (revision === this.settingsRevision && this.overlay?.kind === "settings")
              this.overlay.error = null;
            this.changed();
          },
          (error: unknown) => {
            if (this.cancelled(error)) return;
            if (revision === this.settingsRevision && this.overlay?.kind === "settings") {
              this.overlay.error = `Not saved (applies until you quit): ${describeError(error)}`;
            }
            this.changed();
          }
        );
      void this.own(this.settingsWrites);
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
      exited: (session: ShellSessionTab, code: number | null, signal?: string) =>
        this.guard(() => {
          // Leaving a program on purpose (exit code 0) is done with it, as in any
          // terminal: its tab closes, and with nothing open the launcher shows.
          // Any other ending keeps the tab, its output and "start it again".
          if (code === 0 && !signal) void this.own(this.closeSession(session.sessionId));
        }),
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
      const fresh = session.updateEntry(entry);
      if (fresh || (!session.isLive() && session.status.kind !== "attaching"))
        void this.own(session.attach(true, fresh));
      this.focusTab(existing);
      return session;
    }
    const session = new ShellSessionTab(
      this.shell,
      entry,
      this.sessionSize(),
      this.sessionEvents()
    );
    this.sessions.push(session);
    this.listedTabs.add(session);
    this.focusTab(this.sessions.length - 1);
    void this.own(session.attach(true, true).then(() => this.changed()));
    this.changed();
    return session;
  }

  /** Resume a session from the launcher; one that is not running is started again. */
  private async resume(entry: TerminalSessionEntry): Promise<void> {
    if (entry.running && entry.shellSessionId && !entry.failure) {
      this.openTab(entry);
      return;
    }
    await this.relaunch(entry.sessionId, entry.title);
  }

  private async relaunch(sessionId: string, title: string): Promise<void> {
    this.setNotice(`Resuming ${title}…`);
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
    if (this.cancelled(error)) return;
    const message = `Could not start ${title}: ${describeError(error)}`;
    this.log("error", message);
    this.setNotice(`${message} (details: ${this.prefix()} l)`);
  }

  /** `prefix r`: reattach; a session whose program ended is started again. */
  private async reattach(session: ShellSessionTab): Promise<void> {
    if (
      session.entry.failure ||
      !session.entry.running ||
      session.status.kind === "exited" ||
      !session.entry.shellSessionId
    ) {
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
    this.compositor.invalidate();
    this.changed();
  }

  private removeTab(session: ShellSessionTab): void {
    const index = this.sessions.indexOf(session);
    if (index === -1) return;
    void this.own(session.dispose());
    this.sessions.splice(index, 1);
    if (session.title !== session.entry.title)
      this.programTitles.set(session.sessionId, session.title);
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
      if (this.cancelled(error)) return;
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
    this.overlay = {
      kind: "links",
      tabTitle: session.title,
      urls,
      query: "",
      selected: 0,
    };
  }

  private async openUrl(url: string): Promise<void> {
    if (!isOpenableUrl(url)) {
      this.setNotice("Only http and https links can be opened.");
      return;
    }
    try {
      await this.host.openExternal(url);
      this.setNotice(`Opened ${new URL(url).host} in your browser`);
    } catch (error) {
      if (this.cancelled(error)) return;
      this.log("error", `Could not open ${url}: ${describeError(error)}`);
      this.setNotice(`Could not open the link: ${describeError(error)}`);
    }
  }

  /** Put text on the person's clipboard through their terminal (OSC 52). */
  private copyToClipboard(text: string): void {
    this.terminal.write(`\x1b]52;c;${Buffer.from(text, "utf8").toString("base64")}\x07`);
  }

  // ── copy mode ──────────────────────────────────────────────────────────────

  private openSearch(session: ShellSessionTab): void {
    this.overlay = {
      kind: "search",
      sessionId: session.sessionId,
      query: this.lastSearch,
      selected: 0,
    };
  }

  private enterCopy(session: ShellSessionTab): void {
    const grid = session.grid;
    const cursor = grid.cursor();
    this.copy = {
      sessionId: session.sessionId,
      top: grid.liveTop(),
      cursor: {
        x: Math.min(cursor.x, grid.columns - 1),
        y: grid.liveTop() + cursor.y,
      },
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
      case "/":
        this.openSearch(session);
        break;
      case "n":
      case "N": {
        const matches = grid.search(this.lastSearch);
        const forward = event.name === "n";
        const match = forward
          ? (matches.find(
              (match) =>
                match.start.y > copy.cursor.y ||
                (match.start.y === copy.cursor.y && match.start.x > copy.cursor.x)
            ) ?? matches[0])
          : ([...matches]
              .reverse()
              .find(
                (match) =>
                  match.end.y < copy.cursor.y ||
                  (match.end.y === copy.cursor.y && match.end.x < copy.cursor.x)
              ) ?? matches.at(-1));
        if (match) {
          copy.cursor = { ...match.end };
          copy.anchor = { ...match.start };
        } else this.setNotice("No matching retained rows");
        break;
      }
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
        copy.cursor.x = grid.lineEndColumn(copy.cursor.y);
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
        this.setNotice(
          `Copied ${characters(text)} to your clipboard (if your terminal allows OSC 52)`
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

  private openDetail(title: string, text: string): void {
    this.overlay = { kind: "detail", title, text, scroll: 0, contentHeight: 0 };
  }

  private logText(): string {
    return this.logs
      .map(
        (line) => `${new Date(line.time).toISOString()} ${line.level.toUpperCase()} ${line.message}`
      )
      .join("\n");
  }

  private filePrompt(
    title: string,
    labels: string[],
    submitLabel: string,
    submit: (paths: string[], signal: AbortSignal) => Promise<string>
  ): void {
    this.overlay = {
      kind: "file",
      title,
      labels,
      submitLabel,
      paths: [],
      stage: 0,
      query: "",
      selected: 0,
      pending: false,
      error: null,
      scroll: 0,
      contentHeight: 0,
      controller: new AbortController(),
      submit,
    };
  }

  private saveTextPrompt(title: string, text: string): void {
    this.filePrompt(
      title,
      ["New local output path"],
      "Save text to a new local file",
      async ([localPath], signal) => {
        const result = await this.host.files.saveText({ localPath: localPath!, text }, { signal });
        return `Saved ${result.path} (${result.size} bytes)`;
      }
    );
  }

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
    case "C-c":
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
      state.query = [
        ...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(state.query),
      ]
        .slice(0, -1)
        .map((part) => part.segment)
        .join("");
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
  return selection ? grid.selectedText(selection) : grid.logicalLineText(copy.cursor.y);
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

/** What a click on an overlay stands for: a selection, then the key that acts on it. */
interface OverlayHit {
  select?: number;
  key?: string;
}

/** Overlay-relative cell → what a click there means, or null for nothing. */
type OverlayHitTest = (x: number, y: number) => OverlayHit | null;

function syntheticKey(name: string): KeyEvent {
  return { kind: "key", name, seq: "" };
}

/** The key that runs a prefix binding ("1-9" stands for tab 1). */
function bindingKeyName(binding: Binding): string {
  if (binding.key === "1-9") return "1";
  if (binding.key === "Tab") return "tab";
  return binding.key;
}

/** Clicking a list item selects it and opens it, as Enter does. */
function listClick(items: readonly ListItem[], selected: number, height: number): OverlayHitTest {
  const window = listWindow(items, selected, height);
  return (_x, y) => {
    const index = listItemAt(window, y);
    return index === null ? null : { select: index, key: "enter" };
  };
}
