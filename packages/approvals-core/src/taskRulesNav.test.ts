import { describe, expect, it } from "vitest";
import type { PendingApproval } from "@vibestudio/shared/approvals";
import { routeApprovalDigit } from "./installReviewNav.js";
import { approvalDecisionOptions } from "./decisions.js";
import {
  applyTaskRulesNav,
  effectiveTaskRuleSelection,
  INITIAL_TASK_RULES_NAV,
  isTaskRulesApproval,
  resolveTaskRulesDigit,
  shouldHandleTaskRulesNav,
} from "./taskRulesNav.js";

function facet(key: string, defaultSelected?: boolean) {
  return {
    selectionKey: key,
    ...(defaultSelected === undefined ? {} : { defaultSelected }),
    capability: "workspace.read",
    title: `Action ${key}`,
    row: {} as never,
  };
}

function taskRules(facets = [facet("a"), facet("b"), facet("c", false)]) {
  const approval = {
    kind: "capability",
    approvalId: "rules-1",
    callerId: "system",
    callerKind: "system",
    repoPath: "vibestudio/authority",
    effectiveVersion: "ev",
    requestedAt: 1,
    capability: "workspace.read",
    title: "Allow these planned actions?",
    cardType: "task.rules",
    allowedDecisions: ["task", "deny"],
    authorityFacets: facets,
  } as unknown as PendingApproval;
  if (!isTaskRulesApproval(approval)) throw new Error("fixture is not a task.rules card");
  return approval;
}

describe("task.rules card", () => {
  it("starts from the rows the card offers pre-selected", () => {
    expect([...effectiveTaskRuleSelection(taskRules(), INITIAL_TASK_RULES_NAV)]).toEqual([
      "a",
      "b",
    ]);
  });

  it("moves between rows and toggles the focused one", () => {
    const approval = taskRules();
    let state = applyTaskRulesNav(INITIAL_TASK_RULES_NAV, "right", approval);
    expect(state.rowIndex).toBe(1);
    state = applyTaskRulesNav(state, { char: " " }, approval);
    expect([...effectiveTaskRuleSelection(approval, state)]).toEqual(["a"]);
    state = applyTaskRulesNav(state, "right", approval);
    state = applyTaskRulesNav(state, { char: " " }, approval);
    expect([...effectiveTaskRuleSelection(approval, state)].sort()).toEqual(["a", "c"]);
    state = applyTaskRulesNav(state, "right", approval);
    expect(state.rowIndex).toBe(0);
  });

  it("owns only the keys it acts on", () => {
    expect(shouldHandleTaskRulesNav(taskRules(), "left")).toBe(true);
    expect(shouldHandleTaskRulesNav(taskRules(), "down")).toBe(false);
  });

  it("allows exactly the selected rows, and cannot allow nothing", () => {
    const approval = taskRules();
    expect(resolveTaskRulesDigit(1, approval, INITIAL_TASK_RULES_NAV)).toEqual({
      decision: "accept",
      selected: ["a", "b"],
    });
    const none = { rowIndex: 0, selection: new Set<string>() };
    expect(resolveTaskRulesDigit(1, approval, none)).toBeNull();
    expect(resolveTaskRulesDigit(2, approval, none)).toEqual({ decision: "cancel" });
    expect(resolveTaskRulesDigit(3, approval, none)).toBeNull();
  });

  it("routes digits through resolveTaskRules, never the generic resolve that refuses this card", () => {
    const approval = taskRules();
    expect(approvalDecisionOptions(approval)).toEqual([]);
    expect(routeApprovalDigit(approval, 1, undefined, INITIAL_TASK_RULES_NAV)).toEqual({
      via: "resolveTaskRules",
      approvalId: "rules-1",
      resolution: { decision: "accept", selected: ["a", "b"] },
    });
    expect(routeApprovalDigit(approval, 2, undefined, INITIAL_TASK_RULES_NAV)).toEqual({
      via: "resolveTaskRules",
      approvalId: "rules-1",
      resolution: { decision: "cancel" },
    });
  });
});
