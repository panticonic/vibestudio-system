import type { PendingApproval } from "@vibestudio/shared/approvals";
import type { ApprovalNavKey as NavKey } from "./navKey.js";

/** A `task.rules` approval: the planned actions a chat asks to be allowed up front. */
export type PendingTaskRulesApproval = Extract<PendingApproval, { kind: "capability" }> & {
  cardType: "task.rules";
};

export type TaskRulesResolution =
  | { decision: "accept"; selected: string[] }
  | { decision: "cancel" };

/**
 * The host's cursor into a `task.rules` card: which offered row is focused and
 * the rows the person has toggled. `selection` stays `undefined` until they
 * change something, which means the card's own defaults (the rows it offers
 * pre-selected), exactly as the desktop card seeds its checklist.
 */
export interface TaskRulesNavState {
  rowIndex: number;
  selection: ReadonlySet<string> | undefined;
}

export const INITIAL_TASK_RULES_NAV: TaskRulesNavState = { rowIndex: 0, selection: undefined };

export function isTaskRulesApproval(
  approval: PendingApproval | undefined
): approval is PendingTaskRulesApproval {
  return approval?.kind === "capability" && approval.cardType === "task.rules";
}

export function taskRuleRows(approval: PendingTaskRulesApproval) {
  return approval.authorityFacets ?? [];
}

/** The row keys the card would accept as it stands. */
export function effectiveTaskRuleSelection(
  approval: PendingTaskRulesApproval,
  state: TaskRulesNavState
): ReadonlySet<string> {
  if (state.selection) return state.selection;
  return new Set(
    taskRuleRows(approval)
      .filter((row) => row.defaultSelected !== false)
      .map((row) => row.selectionKey)
  );
}

function isSpace(nav: NavKey): boolean {
  return typeof nav === "object" && nav !== null && "char" in nav && nav.char === " ";
}

/** ←/→ moves between the offered rows; space toggles the focused one. */
export function isTaskRulesNavKey(nav: NavKey): boolean {
  return nav === "left" || nav === "right" || isSpace(nav);
}

export function applyTaskRulesNav(
  state: TaskRulesNavState,
  nav: NavKey,
  approval: PendingTaskRulesApproval
): TaskRulesNavState {
  const rows = taskRuleRows(approval);
  if (rows.length === 0) return state;
  const focused = Math.min(Math.max(state.rowIndex, 0), rows.length - 1);
  if (nav === "left" || nav === "right") {
    const delta = nav === "left" ? -1 : 1;
    return { ...state, rowIndex: (focused + delta + rows.length) % rows.length };
  }
  if (isSpace(nav)) {
    const next = new Set(effectiveTaskRuleSelection(approval, state));
    const key = rows[focused]!.selectionKey;
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return { ...state, selection: next };
  }
  return state;
}

/** The gate a host checks before applying the reducer: inert for every other approval kind. */
export function shouldHandleTaskRulesNav(
  target: PendingApproval | undefined,
  nav: NavKey
): target is PendingTaskRulesApproval {
  return isTaskRulesApproval(target) && isTaskRulesNavKey(nav);
}

/**
 * `1` allows the selected rows (nothing selected resolves nothing: the person
 * would be allowing nothing), `2` declines. Both go through `resolveTaskRules`;
 * the generic `resolve` refuses this card.
 */
export function resolveTaskRulesDigit(
  digit: number,
  approval: PendingTaskRulesApproval,
  state: TaskRulesNavState
): TaskRulesResolution | null {
  if (digit === 1) {
    const selected = [...effectiveTaskRuleSelection(approval, state)];
    return selected.length > 0 ? { decision: "accept", selected } : null;
  }
  if (digit === 2) return { decision: "cancel" };
  return null;
}

/** The decision words, matching the desktop card ("Allow" for a single row). */
export function taskRulesDecisionLabels(approval: PendingTaskRulesApproval): {
  allow: string;
  decline: string;
} {
  return {
    allow: taskRuleRows(approval).length === 1 ? "Allow" : "Allow selected",
    decline: "Don't allow",
  };
}
