import { defineEvaluationSuite } from "@workspace/natlang/evaluation";
import { executorIdentityForChoice, loadModelConfiguration } from "@workspace/natlang/model";
import type { FailureKind, ModelRow, ModelState, Readiness } from "./types.js";

// The executor's production call budget (Base model-catalog MODEL_ROLE_CALL_BUDGETS.executor): the gates measure the
// bounds the program runs under. A suite cannot import workspace source, so it is restated here.
const EXECUTOR_BUDGET = { maxTurns: 12, maxTokens: 16384 };

type CaseInput = { rows: ModelRow[] };
type CaseExpected = {
  executorUsable: boolean;
  executorState: ModelState | "absent";
  preferred: string | null;
  failures: Record<string, FailureKind>;
};

export default defineEvaluationSuite<CaseInput, CaseExpected>({
  id: "local-models-readiness-v1",
  program: { root: ".", id: "local-models", entry: "natlang.ts" },
  components: "lambda-only",
  cases: "./cases.jsonl",
  models: { executor: "default" },
  executorIdentity: executorIdentityForChoice(loadModelConfiguration("default").choice),
  policy: { codeEdits: "deny", settings: EXECUTOR_BUDGET },
  budget: { maxRollouts: 100, maxProposals: 0, maxModelCalls: 600 },
  fixture: {
    async create(testCase, context) {
      const app = (await context.loadFreshProgram()) as {
        localModelReadiness(): Promise<Readiness>;
      };
      // The recorded answer of the local-models extension, as the `localModels` service decodes it.
      const services = {
        localModels: {
          async listModels() {
            return testCase.input.rows;
          },
        },
      };
      return {
        execute: () => context.runtime.run(() => app.localModelReadiness(), { services }),
      };
    },
  },
  score(testCase, observation, outcome) {
    const readiness = (observation as { result?: Readiness }).result;
    const want = testCase.expected!;
    if (outcome.kind !== "returned" || !readiness)
      return {
        quality: 0,
        gates: { completed: false, exact: false },
        feedback: `No report: ${outcome.error?.message ?? "no result"}`,
      };
    const checks: Record<string, boolean> = {
      executorUsable: readiness.executor.usable === want.executorUsable,
      executorState: readiness.executor.state === want.executorState,
      preferred: readiness.preferred === want.preferred,
    };
    for (const [slug, kind] of Object.entries(want.failures))
      checks[`failure:${slug}`] =
        readiness.models.find((model) => model.ref === `local:${slug}`)?.failure === kind;
    const failed = Object.entries(checks)
      .filter(([, ok]) => !ok)
      .map(([name]) => name);
    return {
      quality: (Object.keys(checks).length - failed.length) / Object.keys(checks).length,
      metrics: { checks: Object.keys(checks).length, failed: failed.length },
      gates: { completed: true, exact: failed.length === 0 },
      feedback: failed.length ? `wrong: ${failed.join(", ")}` : "Correct.",
    };
  },
  feedback(testCase, result) {
    return { input: testCase.input, actual: result.outcome.value ?? null };
  },
});
