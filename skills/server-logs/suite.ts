import { defineEvaluationSuite } from "@workspace/natlang/evaluation";
import { executorIdentityForChoice, loadModelConfiguration } from "@workspace/natlang/model";
import type { LogBrief, LogRecord, LogRequest } from "./types.js";

// The executor's production call budget (Base model-catalog MODEL_ROLE_CALL_BUDGETS.executor): the gates measure the
// bounds the program runs under. A suite cannot import workspace source, so it is restated here.
const EXECUTOR_BUDGET = { maxTurns: 12, maxTokens: 16384 };

type Recording = {
  serverBootId: string;
  latestSeq: number;
  totalCaptured: number;
  pid: number;
  startedAt: number;
  records: LogRecord[];
};
type CaseInput = { request: LogRequest; recording: Recording };
type CaseExpected = { status: LogBrief["status"]; classes: Record<string, "notable" | "failure"> };

const LEVELS = ["verbose", "info", "warn", "error"] as const;

/** The `serverLog` service answering from one recorded window, with the real filter semantics of tail, query and stats. */
function recordedServerLog(recording: Recording) {
  const answer = (records: LogRecord[]) => ({
    records,
    latestSeq: recording.latestSeq,
    workspaceId: "recorded",
    serverBootId: recording.serverBootId,
    pid: recording.pid,
    startedAt: recording.startedAt,
  });
  return {
    async tail(limit = 500) {
      return answer(recording.records.slice(-limit));
    },
    async query(
      filter: {
        sinceSeq?: number;
        untilSeq?: number;
        since?: number;
        until?: number;
        level?: (typeof LEVELS)[number];
        tag?: string;
        contains?: string;
        limit?: number;
      } = {}
    ) {
      const floor = filter.level ? LEVELS.indexOf(filter.level) : 0;
      const matches = recording.records.filter(
        (record) =>
          (filter.sinceSeq === undefined || record.seq > filter.sinceSeq) &&
          (filter.untilSeq === undefined || record.seq <= filter.untilSeq) &&
          (filter.since === undefined || record.timestamp >= filter.since) &&
          (filter.until === undefined || record.timestamp <= filter.until) &&
          LEVELS.indexOf(record.level) >= floor &&
          (filter.tag === undefined || record.tag === filter.tag) &&
          (filter.contains === undefined ||
            record.message.toLowerCase().includes(filter.contains.toLowerCase()))
      );
      return answer(matches.slice(-(filter.limit ?? 500)));
    },
    async stats() {
      const byLevel = { verbose: 0, info: 0, warn: 0, error: 0 };
      const byTag = new Map<string, number>();
      for (const record of recording.records) {
        byLevel[record.level] += 1;
        if (record.tag) byTag.set(record.tag, (byTag.get(record.tag) ?? 0) + 1);
      }
      return {
        bufferSize: recording.records.length,
        totalCaptured: recording.totalCaptured,
        oldestSeq: recording.records[0]?.seq ?? null,
        latestSeq: recording.latestSeq,
        byLevel,
        byTag: [...byTag].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count),
      };
    },
  };
}

export default defineEvaluationSuite<CaseInput, CaseExpected>({
  id: "server-logs-brief-v1",
  program: { root: ".", id: "server-logs", entry: "natlang.ts" },
  components: "lambda-only",
  cases: "./cases.jsonl",
  models: { executor: "default" },
  executorIdentity: executorIdentityForChoice(loadModelConfiguration("default").choice),
  policy: { codeEdits: "deny", settings: EXECUTOR_BUDGET },
  budget: { maxRollouts: 100, maxProposals: 0, maxModelCalls: 6000 },
  fixture: {
    async create(testCase, context) {
      const app = (await context.loadFreshProgram()) as {
        briefServerLog: { collect(request: LogRequest): Promise<LogBrief> };
      };
      const services = { serverLog: recordedServerLog(testCase.input.recording) };
      return {
        execute: () =>
          context.runtime.run(() => app.briefServerLog.collect(testCase.input.request), {
            services,
          }),
      };
    },
  },
  score(testCase, observation, outcome) {
    const brief = (observation as { result?: LogBrief }).result;
    const { recording, request } = testCase.input;
    const expected = testCase.expected!;
    if (outcome.kind !== "returned" || !brief)
      return {
        quality: 0,
        gates: { completed: false, identity: false, cited: false, status: false },
        feedback: `No brief: ${outcome.error?.message ?? "no result"}`,
      };
    const read = new Set(
      recording.records
        .filter(
          (record) =>
            !request.level ||
            ["verbose", "info", "warn", "error"].indexOf(record.level) >=
              ["verbose", "info", "warn", "error"].indexOf(request.level)
        )
        .map((record) => record.seq)
    );
    const wanted = new Map(
      Object.entries(expected.classes).map(([seq, judged]) => [Number(seq), judged])
    );
    let exact = 0,
      wrongClass = 0,
      falseAlarms = 0;
    for (const finding of brief.findings) {
      const want = wanted.get(finding.firstSeq);
      if (want === undefined) falseAlarms += 1;
      else if (want === finding.class) exact += 1;
      else wrongClass += 1;
    }
    const denominator = wanted.size + falseAlarms;
    const quality = denominator === 0 ? 1 : (exact + 0.5 * wrongClass) / denominator;
    return {
      quality,
      metrics: { exact, wrongClass, falseAlarms, missed: wanted.size - exact - wrongClass },
      gates: {
        completed: true,
        identity:
          brief.serverBootId === recording.serverBootId && brief.latestSeq === recording.latestSeq,
        cited: brief.findings.every(
          (finding) => read.has(finding.firstSeq) && read.has(finding.lastSeq)
        ),
        status: brief.status === expected.status,
      },
      feedback: `status ${brief.status} (want ${expected.status}); exact ${exact}, wrong class ${wrongClass}, false alarms ${falseAlarms}, missed ${wanted.size - exact - wrongClass}`,
    };
  },
  feedback(testCase, result) {
    return { input: testCase.input.request, actual: result.outcome.value ?? null };
  },
});
