import type { ServerLogRecord } from "@vibestudio/service-schemas/serverLog";
import type {
  SystemInvestigationReport,
  SystemLogAuditInput,
  SystemLogInput,
  SystemLogWindowReport,
  SystemStatus,
} from "../system-investigation/types.js";

export const workerdLogTag = "WorkerdManager";

export type LogAuditSeed = {
  marker: string;
  boot: string;
  workspaceId: string;
  start: number;
  steps: number[];
};
type LogQuery = {
  sinceSeq: number;
  tag: string;
  limit: number;
  untilSeq: number;
  contains: string;
};
type LogWindow = {
  records: ServerLogRecord[];
  latestSeq: number;
  serverBootId: string;
  workspaceId: string;
};
type World = {
  id: string;
  goal: string;
  lines: string[];
  windows: {
    title: string;
    cursor: number | null;
    tag: string;
    oldBoot?: boolean;
    status: SystemStatus;
    code: string;
    evidence: number[];
  }[];
};

const preRestart = "retired-workspace-log-boot";

export function prepareManagedLogAudit(
  queryLog: (filter: LogQuery) => Promise<LogWindow>,
  contextId: string,
  world: World,
  seed: LogAuditSeed,
) {
  const lastStep = seed.steps.at(-1);
  if (
    lastStep === undefined ||
    !seed.steps.every(
      (seq, index) => seq > (seed.steps[index - 1] ?? seed.start),
    )
  )
    throw new Error("Host log seed is missing or did not advance");
  const upper: number = lastStep;

  const windows: SystemLogInput[] = world.windows.map((window) => ({
    kind: "server-log-incident",
    goal: window.title,
    tag: window.tag,
    expectedBoot: window.oldBoot ? preRestart : seed.boot,
    sinceSeq: window.cursor === null ? seed.start : seed.steps[window.cursor]!,
  }));
  const request: SystemLogAuditInput = {
    kind: "server-log-audit",
    goal: world.goal,
    windows,
  };
  const expectedWindows = world.windows.map(
    ({ status, code, oldBoot, evidence }) => ({
      status,
      findings: [
        {
          code,
          evidenceIds: oldBoot
            ? [seed.boot]
            : evidence.map((index) => `${seed.boot}:${seed.steps[index]}`),
        },
      ],
    }),
  );
  const ordered = ["blocked", "attention", "inconclusive", "ready"] as const;
  const expected: SystemInvestigationReport = {
    status:
      ordered.find((status) =>
        expectedWindows.some((window) => window.status === status),
      ) ?? "ready",
    findings: expectedWindows.flatMap((window) => window.findings),
    windows: expectedWindows,
  };
  const observed: { input: SystemLogInput; boot: string; records: number[] }[] =
    [];
  function matchesFindings(
    actual: SystemLogWindowReport["findings"] | undefined,
    wanted: SystemLogWindowReport["findings"],
  ) {
    return (
      Array.isArray(actual) &&
      actual.length === wanted.length &&
      wanted.every(
        ({ code, evidenceIds }, index) =>
          actual[index]?.code === code &&
          JSON.stringify(actual[index]?.evidenceIds) ===
            JSON.stringify(evidenceIds),
      )
    );
  }

  async function query(filter: {
    sinceSeq: number;
    tag: string;
    limit: number;
  }) {
    const input = windows[observed.length];
    if (
      !input ||
      input.sinceSeq !== filter.sinceSeq ||
      input.tag !== filter.tag ||
      filter.limit !== 100
    )
      throw new Error("Read only the next assigned host log window");

    const snapshot = await queryLog({
      ...filter,
      untilSeq: upper,
      contains: seed.marker,
    });
    if (
      snapshot.workspaceId !== seed.workspaceId ||
      snapshot.serverBootId !== seed.boot
    )
      throw new Error(
        "The assigned host log changed while the case was active",
      );
    const allowed =
      input.tag === workerdLogTag
        ? seed.steps.filter((seq) => seq > input.sinceSeq)
        : [];
    const numbers = snapshot.records.map(({ seq }) => seq);
    const records = snapshot.records.map(
      ({ seq, timestamp, level, tag, message }) => {
        const marker = `${seed.marker} `;
        const ownedLine = message
          .split(/\r?\n/u)
          .find((line) => line.includes(marker));
        const text = ownedLine
          ?.slice(ownedLine.indexOf(marker) + marker.length)
          .trim();
        if (
          tag !== input.tag ||
          text === undefined ||
          text !== world.lines[seed.steps.indexOf(seq)]
        )
          throw new Error("Host log record has another message or subsystem");
        return { seq, timestamp, level, tag, message: text };
      },
    );
    if (JSON.stringify(numbers) !== JSON.stringify(allowed))
      throw new Error(
        "Host log query returned a different window from the seeded operation",
      );
    observed.push({ input, boot: snapshot.serverBootId, records: numbers });
    return { serverBootId: snapshot.serverBootId, latestSeq: upper, records };
  }

  function verify(report: SystemInvestigationReport | null) {
    const checks = {
      exactWindows: observed.length === windows.length,
      summary:
        report?.status === expected.status &&
        matchesFindings(report.findings, expected.findings),
      reports:
        Array.isArray(report?.windows) &&
        report.windows.length === expectedWindows.length &&
        expectedWindows.every((window, index) => {
          const actual = report.windows?.[index];
          return (
            actual?.status === window.status &&
            matchesFindings(actual.findings, window.findings)
          );
        }),
    };
    return {
      contextId,
      caseId: world.id,
      seed,
      observed,
      expected,
      checks,
      passed: Object.values(checks).every(Boolean),
    };
  }
  return { request, expected, verify, services: { serverLog: { query } } };
}
