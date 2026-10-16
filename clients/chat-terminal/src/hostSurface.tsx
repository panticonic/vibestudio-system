/**
 * The chat client's trusted chrome: the approvals overlay and the update
 * prompt. They are drawn by this client (never by the conversation) in place
 * of the chat screen, and while they are open they own the keyboard, so
 * nothing a conversation prints can imitate or answer them. They open only
 * when the person asks (Ctrl-G): an approval that arrives while someone is
 * typing is announced in the composer's placeholder and never captures keys.
 */
import React from "react";
import { Box, Text } from "ink";
import type { PendingApproval } from "@vibestudio/shared/approvals";
import type { PendingClientUpdate } from "@workspace/client-update-core";
import {
  applyInstallReviewNav,
  applyTaskRulesNav,
  editProtectedInput,
  effectiveTaskRuleSelection,
  focusedRowKeyOf,
  INITIAL_INSTALL_REVIEW_NAV,
  INITIAL_TASK_RULES_NAV,
  isProtectedApproval,
  isTaskRulesApproval,
  newProtectedInput,
  routeApprovalDigit,
  shouldHandleInstallReviewNav,
  shouldHandleTaskRulesNav,
  submitProtectedInput,
  type ApprovalNavKey,
  type ApprovalQueue,
  type ApprovalsClient,
  type InstallReviewNavState,
  type ProtectedInputEvent,
  type ProtectedInputState,
  type TaskRulesNavState,
} from "@workspace/approvals-core";
import {
  ApprovalsOverlay,
  ClientUpdatePrompt,
  approvalPanelHeight,
  clampScroll,
} from "@workspace/client-kit-terminal";
import type {
  ChatHostSurface,
  HostSurfaceSize,
  HostSurfaceState,
  InputEvent,
  KeyEvent,
} from "@workspace/terminal-chat";

/** The key that opens the surface (Ctrl-G): free in the chat's keymap. */
export const SURFACE_KEY_LABEL = "Ctrl-G";

export interface SurfacePorts {
  queue: ApprovalQueue;
  approvals: ApprovalsClient;
  /** The newest ready build of this client not yet adopted, as the update prompt shows it. */
  pendingUpdate(): PendingClientUpdate | null;
  /** End this run at a safe point so the host re-enters the client on the pending build. */
  restartAtSafePoint(): void;
  /** Report a failure the person must see (a decision that was not recorded). */
  report(message: string, error: unknown): void;
}

type Pane = { kind: "closed" } | { kind: "approvals" } | { kind: "update" };

export class HostSurface implements ChatHostSurface {
  readonly #ports: SurfacePorts;
  readonly #listeners = new Set<() => void>();
  readonly #work = new Set<Promise<void>>();
  #pending: readonly PendingApproval[] = [];
  #pane: Pane = { kind: "closed" };
  #approvalId: string | null = null;
  #scroll = 0;
  #contentHeight = 0;
  #nav: InstallReviewNavState = INITIAL_INSTALL_REVIEW_NAV;
  #taskRules: TaskRulesNavState = INITIAL_TASK_RULES_NAV;
  #protectedInput: ProtectedInputState = newProtectedInput();
  #size: HostSurfaceSize = { columns: 80, rows: 24 };
  #snapshot: HostSurfaceState = { view: null, attention: null };
  #stop: (() => void) | null = null;
  #disposed = false;

  constructor(ports: SurfacePorts) {
    this.#ports = ports;
    this.#recompute();
  }

  /** Mirror the authoritative queue; resolves once its first read is in. */
  async start(): Promise<void> {
    this.#stop = this.#ports.queue.subscribe(() => this.#applyQueue());
    await this.#ports.queue.start();
    this.#applyQueue();
  }

  /** Stop mirroring and join the decisions still in flight. */
  async dispose(reason?: unknown): Promise<void> {
    this.#disposed = true;
    this.#stop?.();
    this.#stop = null;
    await this.#ports.queue.stop(reason);
    await Promise.allSettled([...this.#work]);
  }

  /** The update state changed (a build became ready). */
  updateChanged(): void {
    if (this.#pane.kind === "update" && !this.#ports.pendingUpdate()) this.#pane = { kind: "closed" };
    this.#changed();
  }

  getSnapshot = (): HostSurfaceState => this.#snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  handleInput(event: InputEvent): boolean {
    if (event.type === "focus") return false;
    if (this.#pane.kind === "closed") {
      if (event.type === "key" && event.ctrl && event.name === "char" && event.text === "g") {
        // Nothing to open: the key is the chat's own.
        return this.#open();
      }
      return false;
    }
    if (event.type === "mouse") return true;
    if (this.#pane.kind === "update") this.#updateKey(event);
    else this.#approvalsKey(event);
    this.#changed();
    return true;
  }

  // ── state ──────────────────────────────────────────────────────────────────

  #applyQueue(): void {
    if (this.#disposed) return;
    const state = this.#ports.queue.getSnapshot();
    const previous = this.#pending;
    this.#pending = state.pending;
    if (this.#pane.kind === "approvals") {
      if (previous.length > 0 && state.pending.length === 0) {
        // The queue was worked through: give the keyboard back.
        this.#pane = { kind: "closed" };
        this.#resetSelection(null);
      } else if (!state.pending.some((a) => a.approvalId === this.#approvalId)) {
        // Removal never transfers consent to a different request.
        this.#resetSelection(null);
      }
    }
    this.#changed();
  }

  #resetSelection(approvalId: string | null): void {
    this.#approvalId = approvalId;
    this.#scroll = 0;
    this.#contentHeight = 0;
    this.#nav = INITIAL_INSTALL_REVIEW_NAV;
    this.#taskRules = INITIAL_TASK_RULES_NAV;
    this.#protectedInput = newProtectedInput();
  }

  /** Open the approvals or, failing that, the update prompt; false when neither has anything to show. */
  #open(): boolean {
    if (this.#pending.length > 0) {
      this.#pane = { kind: "approvals" };
      this.#resetSelection(this.#pending[0]!.approvalId);
    } else if (this.#ports.pendingUpdate()) this.#pane = { kind: "update" };
    else return false;
    this.#changed();
    return true;
  }

  #index(): number {
    return this.#pending.findIndex((a) => a.approvalId === this.#approvalId);
  }

  #changed(): void {
    this.#recompute();
    for (const listener of [...this.#listeners]) listener();
  }

  #recompute(): void {
    const update = this.#ports.pendingUpdate();
    const waiting = this.#pending.length;
    const attention =
      this.#pane.kind !== "closed"
        ? null
        : waiting > 0
          ? `${waiting} approval${waiting === 1 ? "" : "s"} waiting — ${SURFACE_KEY_LABEL} answers`
          : update
            ? `An update is ready — ${SURFACE_KEY_LABEL}`
            : null;
    const pane = this.#pane;
    this.#snapshot = {
      view:
        pane.kind === "approvals"
          ? (size) => this.#approvalsView(size)
          : pane.kind === "update"
            ? (size) => this.#updateView(size)
            : null,
      attention,
    };
  }

  // ── approvals ──────────────────────────────────────────────────────────────

  #installProps() {
    const current = this.#pending[this.#index()];
    if (isTaskRulesApproval(current)) {
      return {
        taskRuleSelection: effectiveTaskRuleSelection(current, this.#taskRules),
        taskRuleFocus: this.#taskRules.rowIndex,
      };
    }
    if (current?.kind !== "unit-install-review") return {};
    const rowKey = focusedRowKeyOf(this.#nav, current.parts);
    return {
      partIndex: this.#nav.partIndex,
      ...(this.#nav.selection ? { installSelection: this.#nav.selection } : {}),
      ...(rowKey ? { focusedRowKey: rowKey } : {}),
    };
  }

  #detailRows(): number {
    const natural = approvalPanelHeight({
      pending: this.#pending,
      selectedIndex: this.#index(),
      width: this.#size.columns,
      contentHeight: this.#contentHeight,
      rowExpanded: "focusedRowKey" in this.#installProps(),
    });
    const chrome = natural - Math.max(1, this.#contentHeight);
    return Math.max(1, this.#size.rows - chrome);
  }

  #approvalsView(size: HostSurfaceSize): React.ReactElement {
    this.#size = size;
    return (
      <Box flexDirection="column" width={size.columns} height={size.rows}>
        <ApprovalsOverlay
          pending={[...this.#pending]}
          selectedIndex={this.#index()}
          {...this.#installProps()}
          protectedInput={this.#protectedInput}
          height={size.rows}
          width={size.columns}
          detailScroll={this.#scroll}
          detailContentHeight={this.#contentHeight}
          onDetailHeight={(rows) => {
            if (this.#contentHeight !== rows) {
              this.#contentHeight = rows;
              this.#changed();
            }
          }}
        />
      </Box>
    );
  }

  #approvalsKey(event: Exclude<InputEvent, { type: "mouse" | "focus" }>): void {
    const target = this.#pending[this.#index()];
    const nav = event.type === "key" ? navKeyOf(event) : null;
    const scrolling = nav === "up" || nav === "down" || nav === "pageup" || nav === "pagedown";
    if (isProtectedApproval(target) && !scrolling && nav !== "home" && nav !== "end") {
      if (event.type === "key" && event.ctrl && event.text === "d") {
        this.#protectedInput = newProtectedInput();
        this.#decide(() => this.#ports.approvals.resolve(target.approvalId, "deny"));
        return;
      }
      const result = editProtectedInput(target, this.#protectedInput, protectedEventOf(event));
      if (result === "cancel") {
        this.#protectedInput = newProtectedInput();
        this.#pane = { kind: "closed" };
      }
      if (result === "submit") {
        const state = this.#protectedInput;
        this.#decide(
          () => submitProtectedInput(this.#ports.approvals, target, state),
          () => {
            state.error = "Submission failed. Values remain here; retry or cancel.";
          }
        );
      }
      return;
    }
    if (event.type !== "key") return;
    const detailRows = this.#detailRows();
    if (nav === "escape") {
      this.#pane = { kind: "closed" };
    } else if (nav === "up" || nav === "down") {
      const index = this.#index();
      const next = Math.max(0, Math.min(this.#pending.length - 1, (index < 0 ? 0 : index) + (nav === "up" ? -1 : 1)));
      const chosen = this.#pending[next];
      if (chosen && chosen.approvalId !== this.#approvalId) this.#resetSelection(chosen.approvalId);
    } else if (nav === "pageup" || nav === "pagedown") {
      this.#scroll = clampScroll(
        this.#scroll + (nav === "pageup" ? -detailRows : detailRows),
        this.#contentHeight,
        detailRows
      );
    } else if (nav === "home") {
      this.#scroll = 0;
    } else if (nav === "end") {
      this.#scroll = clampScroll(Number.MAX_SAFE_INTEGER, this.#contentHeight, detailRows);
    } else if (target && shouldHandleInstallReviewNav(target, nav)) {
      this.#nav = applyInstallReviewNav(this.#nav, nav, target.parts);
    } else if (target && shouldHandleTaskRulesNav(target, nav)) {
      this.#taskRules = applyTaskRulesNav(this.#taskRules, nav, target);
    } else if (nav && typeof nav === "object" && "digit" in nav) {
      const route = routeApprovalDigit(target, nav.digit, this.#nav.selection, this.#taskRules);
      const approvals = this.#ports.approvals;
      if (route.via === "resolve") this.#decide(() => approvals.resolve(route.approvalId, route.decision));
      else if (route.via === "resolveTaskRules")
        this.#decide(() => approvals.resolveTaskRules(route.approvalId, route.resolution));
      else if (route.via === "resolveInstallReview")
        this.#decide(() => approvals.resolveInstallReview(route.approvalId, route.resolution));
    }
  }

  /** Send one decision; the authoritative queue then drops the request. A failure is reported, never swallowed. */
  #decide(send: () => Promise<unknown>, onFailure?: () => void): void {
    const work = send()
      .then(() => this.#ports.queue.refresh())
      .catch((error: unknown) => {
        if (this.#disposed) return;
        onFailure?.();
        this.#ports.report("Your decision was not recorded", error);
        void this.#ports.queue.refresh().catch(() => {});
      })
      .finally(() => {
        this.#work.delete(work);
        if (!this.#disposed) this.#changed();
      });
    this.#work.add(work);
  }

  // ── update ─────────────────────────────────────────────────────────────────

  #updateView(size: HostSurfaceSize): React.ReactElement {
    const update = this.#ports.pendingUpdate();
    return (
      <Box flexDirection="column" width={size.columns} height={size.rows}>
        <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} width={size.columns}>
          {update ? <ClientUpdatePrompt update={update} width={size.columns - 4} /> : <Text>No update is waiting.</Text>}
          <Text dimColor wrap="wrap">
            Your conversation stays on the server and your draft is kept; the chat reopens on the new version.
          </Text>
        </Box>
      </Box>
    );
  }

  #updateKey(event: Exclude<InputEvent, { type: "mouse" | "focus" }>): void {
    if (event.type !== "key") return;
    if (event.name === "char" && !event.ctrl && event.text === "r") {
      this.#pane = { kind: "closed" };
      this.#ports.restartAtSafePoint();
    } else if (event.name === "escape" || (event.name === "char" && event.text === "l")) {
      this.#pane = { kind: "closed" };
    }
  }
}

/** The approval navigation vocabulary for a chat key event. */
export function navKeyOf(event: KeyEvent): ApprovalNavKey {
  switch (event.name) {
    case "up":
    case "down":
    case "left":
    case "right":
    case "tab":
    case "enter":
    case "escape":
    case "pageup":
    case "pagedown":
    case "home":
    case "end":
    case "backspace":
      return event.name;
    case "char":
      if (event.ctrl) {
        if (event.text === "p") return "up";
        if (event.text === "n") return "down";
        if (event.text === "h") return "backspace";
        return null;
      }
      if (event.meta) return null;
      if (event.text >= "1" && event.text <= "9" && [...event.text].length === 1)
        return { digit: Number(event.text) };
      return { char: event.text };
    default:
      return null;
  }
}

function protectedEventOf(event: Exclude<InputEvent, { type: "mouse" | "focus" }>): ProtectedInputEvent {
  if (event.type === "paste") return { kind: "paste", text: event.text };
  if (event.name === "tab") return { kind: "key", name: event.shift ? "backtab" : "tab" };
  if (event.name === "char") {
    if (event.ctrl || event.meta) return { kind: "key", name: "" };
    // A chunk of several characters is text that arrived at once, as a paste does.
    return [...event.text].length > 1
      ? { kind: "paste", text: event.text }
      : { kind: "key", name: event.text };
  }
  return { kind: "key", name: event.name };
}
