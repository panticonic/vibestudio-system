import type {
  SystemClientEvidence,
  SystemInvestigationReport,
  SystemInvestigationRequest,
  SystemLogRecord,
  SystemModelObservation,
  SystemPerformanceRun,
  SystemRemoteEvidence,
  SystemStatus,
} from "../system-investigation/types.js";

export type SystemInvestigationWorld = {
  id: string;
  sourceGroup: string;
  request: SystemInvestigationRequest;
  evidence?: {
    modelRows?: SystemModelObservation[];
    log?: {
      serverBootId: string;
      latestSeq: number;
      records: SystemLogRecord[];
    };
  };
  expected: SystemInvestigationReport;
};

function world(
  id: string,
  request: SystemInvestigationRequest,
  status: SystemStatus,
  code: string,
  evidenceIds: string[],
  evidence?: SystemInvestigationWorld["evidence"],
): SystemInvestigationWorld {
  return {
    id: `system-investigation-${id}`,
    sourceGroup: `vibestudio:system-investigation:${request.kind}:${id}`,
    request,
    ...(evidence ? { evidence } : {}),
    expected: { status, findings: [{ code, evidenceIds }] },
  };
}

function performance(
  id: string,
  goal: string,
  boundary: SystemPerformanceRun["boundary"],
  baseline: number[],
  candidate: number[],
  budget: number,
  status: SystemStatus,
  code: string,
  changes: Partial<
    Pick<SystemPerformanceRun, "boundary" | "cache" | "workload">
  > = {},
) {
  const common = { boundary, cache: "warm" as const, workload: id };
  const oldId = `${id}-baseline`;
  const newId = `${id}-candidate`;
  return world(
    id,
    {
      kind: "performance",
      goal,
      baseline: { ...common, id: oldId, elapsedMs: baseline },
      candidate: { ...common, ...changes, id: newId, elapsedMs: candidate },
      regressionBudgetPercent: budget,
    },
    status,
    code,
    [oldId, newId],
  );
}

type ClientCheck = [
  SystemClientEvidence["stage"],
  SystemClientEvidence["state"],
  string,
  revision?: string,
];
function clientCase(
  id: string,
  goal: string,
  checks: ClientCheck[],
  status: SystemStatus,
  code: string,
  receipt?: number,
) {
  return world(
    id,
    {
      kind: "client-development",
      goal,
      revision: "candidate",
      checks: checks.map(
        ([stage, state, detail, revision = "candidate"], index) => ({
          id: `${id}-${index + 1}`,
          stage,
          state,
          revision,
          detail,
        }),
      ),
    },
    status,
    code,
    receipt === undefined ? [] : [`${id}-${receipt}`],
  );
}

type RemoteCheck = [
  SystemRemoteEvidence["phase"],
  SystemRemoteEvidence["state"],
  string,
];
function remoteCase(
  id: string,
  goal: string,
  checks: RemoteCheck[],
  status: SystemStatus,
  code: string,
  receipt?: number,
) {
  return world(
    id,
    {
      kind: "remote-access",
      goal,
      checks: checks.map(([phase, state, detail], index) => ({
        id: `${id}-${index + 1}`,
        phase,
        state,
        detail,
      })),
    },
    status,
    code,
    receipt === undefined ? [] : [`${id}-${receipt}`],
  );
}

function modelCase(
  id: string,
  goal: string,
  slug: string,
  status: SystemStatus,
  code: string,
  modelRows: SystemModelObservation[],
) {
  return world(
    id,
    { kind: "model-readiness", goal, slug, incidentLog: null },
    status,
    code,
    modelRows.some((row) => row.slug === slug) ? [`local:${slug}`] : [],
    { modelRows },
  );
}

function model(
  slug: string,
  state: SystemModelObservation["state"],
  fit: SystemModelObservation["fit"]["fit"] = "full-gpu",
  errorMessage: string | null = null,
): SystemModelObservation {
  return { slug, state, fit: { fit }, errorMessage };
}

function logCase(
  id: string,
  goal: string,
  tag: string,
  lines: [number, SystemLogRecord["level"], string, tag?: string][],
  status: SystemStatus,
  code: string,
  evidenceIds: number[] = [],
  serverBootId = "boot-2",
) {
  return world(
    id,
    {
      kind: "server-log-incident",
      goal,
      tag,
      expectedBoot: "boot-2",
      sinceSeq: 20,
    },
    status,
    code,
    serverBootId !== "boot-2"
      ? [serverBootId]
      : evidenceIds.map((seq) => `${serverBootId}:${seq}`),
    {
      log: {
        serverBootId,
        latestSeq: Math.max(20, ...lines.map(([seq]) => seq)),
        records: lines.map(([seq, level, message, source = tag]) => ({
          seq,
          level,
          message,
          tag: source,
          timestamp: seq * 1000,
        })),
      },
    },
  );
}

function modelIncident(
  id: string,
  goal: string,
  requestedModel: SystemModelObservation,
  logfile: NonNullable<SystemInvestigationWorld["evidence"]>["log"],
  primary: string,
  followup?: { code: string; evidenceIds: string[] },
): SystemInvestigationWorld {
  const mode = requestedModel.state === "error" ? "blocked" : "ready";
  const fixture = world(
    id,
    {
      kind: "model-readiness",
      goal,
      slug: requestedModel.slug,
      incidentLog: {
        kind: "server-log-incident",
        goal: "Resolve only the selected engine operation",
        expectedBoot: "engine-boot",
        sinceSeq: 40,
        tag: "Engine",
      },
    },
    mode,
    primary,
    [`local:${requestedModel.slug}`],
    { modelRows: [requestedModel], ...(logfile ? { log: logfile } : {}) },
  );
  if (followup) fixture.expected.findings.push(followup);
  return fixture;
}

export const systemInvestigationWorlds: SystemInvestigationWorld[] = [
  performance(
    "panel-action-slow",
    "Did the action-to-visible-settings latency regress?",
    "panel-action",
    [99, 101, 100, 102, 98],
    [124, 128, 125, 126, 123],
    10,
    "attention",
    "regression",
  ),
  performance(
    "build-exact-budget",
    "Decide whether the build exceeded the allowed 20 percent increase.",
    "build",
    [19, 20, 21],
    [22, 24, 25],
    20,
    "ready",
    "within-budget",
  ),
  performance(
    "cold-vs-warm",
    "Can I cite this workspace startup comparison as an improvement?",
    "workspace-boot",
    [500, 520, 510],
    [270, 280, 260],
    12,
    "inconclusive",
    "incomparable",
    { cache: "cold" },
  ),
  performance(
    "missing-repetitions",
    "Did agent reply time improve in the candidate?",
    "agent-reply",
    [400, 410, 390],
    [300, 301],
    5,
    "inconclusive",
    "insufficient-samples",
  ),
  performance(
    "interaction-vs-boot",
    "Compare the panel action with the initial-render numbers.",
    "panel-action",
    [12, 14, 10],
    [11, 12, 13],
    8,
    "inconclusive",
    "incomparable",
    { boundary: "workspace-boot" },
  ),
  performance(
    "outlier-does-not-dominate",
    "Check whether one slow build spoiled the median.",
    "build",
    [40, 40, 40, 41, 42],
    [37, 38, 40, 41, 400],
    5,
    "ready",
    "within-budget",
  ),
  performance(
    "load-mismatch",
    "Are these reply timings from the same load comparable?",
    "agent-reply",
    [81, 79, 80],
    [88, 89, 90],
    5,
    "inconclusive",
    "incomparable",
    { workload: "concurrent-routing" },
  ),
  performance(
    "even-median-regression",
    "Judge the warm workspace boot median with four trials.",
    "workspace-boot",
    [93, 97, 103, 107],
    [103, 107, 115, 119],
    10,
    "attention",
    "regression",
  ),
  performance(
    "zero-timer",
    "Check whether the recorded build timers establish a regression.",
    "build",
    [30, 31, 32],
    [40, 0, 42],
    10,
    "inconclusive",
    "insufficient-samples",
  ),

  clientCase(
    "build-blocks-launch",
    "Where did the candidate stop before the client opened?",
    [
      ["build", "failed", "The compiler failed before a bundle was emitted."],
      ["activation", "skipped", "No candidate available."],
    ],
    "blocked",
    "build",
    1,
  ),
  clientCase(
    "stale-client-runtime",
    "Can I count the open old client as coverage for my new revision?",
    [
      ["build", "passed", "Candidate bundle produced."],
      ["activation", "passed", "The deployment selected the candidate."],
      ["runtime", "passed", "The previous attempt is still alive.", "previous"],
      [
        "user-check",
        "passed",
        "Previous revision painted the expected page.",
        "previous",
      ],
    ],
    "inconclusive",
    "incomplete-attempt",
  ),
  clientCase(
    "activation-refused",
    "Why didn't the successful build reach the app?",
    [
      ["build", "passed", "Immutable artifact present."],
      ["activation", "failed", "Activation rejected the selected artifact."],
    ],
    "blocked",
    "activation",
    2,
  ),
  clientCase(
    "runtime-start-failed",
    "Did the client start once its new revision was activated?",
    [
      ["build", "passed", "Build succeeded."],
      ["activation", "passed", "Requested revision adopted."],
      ["runtime", "failed", "Main process terminated before readiness."],
    ],
    "blocked",
    "runtime",
    3,
  ),
  clientCase(
    "visible-control-mismatch",
    "Does an open window prove the action works?",
    [
      ["build", "passed", "Bundle built."],
      ["activation", "passed", "Correct attempt loaded."],
      ["runtime", "passed", "Window is ready."],
      [
        "user-check",
        "failed",
        "The requested control still has the old value.",
      ],
    ],
    "blocked",
    "user-check",
    4,
  ),
  clientCase(
    "client-verified",
    "Report whether the exact candidate passed its observed interaction.",
    [
      [
        "user-check",
        "passed",
        "Actual accessible button opened the intended view.",
      ],
      ["runtime", "passed", "Candidate runtime reported ready."],
      ["build", "passed", "Candidate bundle built."],
      ["activation", "passed", "Requested artifact adopted."],
    ],
    "ready",
    "verified-client",
    1,
  ),
  clientCase(
    "skipped-visible-check",
    "Can the build and live runtime certify a deliberately skipped interaction?",
    [
      ["build", "passed", "New artifact built."],
      ["activation", "passed", "Artifact selected."],
      ["runtime", "passed", "The new client is ready."],
      ["user-check", "skipped", "No user-facing probe ran."],
    ],
    "inconclusive",
    "incomplete-attempt",
    4,
  ),

  remoteCase(
    "remote-device-runtime",
    "What blocked the remote client before server contact?",
    [
      ["device-runtime", "failed", "The client transport module did not load."],
      ["hub", "skipped", "No healthy client transport."],
    ],
    "blocked",
    "device-runtime",
    1,
  ),
  remoteCase(
    "remote-host-runtime",
    "Find the first unavailable phase in these deployment receipts.",
    [
      ["device-runtime", "passed", "Registered client runtime responded."],
      [
        "host-runtime",
        "failed",
        "The workspace supervisor failed its own readiness check.",
      ],
    ],
    "blocked",
    "host-runtime",
    2,
  ),
  remoteCase(
    "remote-hub",
    "Can the existing control connection be used?",
    [
      ["device-runtime", "passed", "Transport initialized."],
      ["host-runtime", "passed", "Host readiness passed."],
      ["hub", "failed", "Recorded control check could not complete."],
    ],
    "blocked",
    "hub",
    3,
  ),
  remoteCase(
    "remote-route",
    "The hub responded but the requested workspace is absent. Diagnose the observed boundary.",
    [
      ["device-runtime", "passed", "Transport initialized."],
      ["host-runtime", "passed", "Host ready."],
      ["hub", "passed", "Control probe returned successfully."],
      ["workspace", "failed", "No route for the chosen workspace."],
      ["endpoint", "skipped", "No route selected."],
    ],
    "blocked",
    "workspace",
    4,
  ),
  remoteCase(
    "remote-endpoint",
    "The workspace resolved but never became reachable. Which readback controls readiness?",
    [
      ["device-runtime", "passed", "Transport available."],
      ["host-runtime", "passed", "Host ready."],
      ["hub", "passed", "Control connection established."],
      ["workspace", "passed", "Selected workspace route exists."],
      ["endpoint", "failed", "Selected child never reported registered."],
    ],
    "blocked",
    "endpoint",
    5,
  ),
  remoteCase(
    "remote-missing-workspace-check",
    "Are downstream logs enough to skip an unobserved workspace check?",
    [
      ["device-runtime", "passed", "Client running."],
      ["host-runtime", "passed", "Host ready."],
      ["hub", "passed", "Control successful."],
      [
        "endpoint",
        "failed",
        "An endpoint exited, but its route was not checked.",
      ],
    ],
    "inconclusive",
    "incomplete-route",
  ),
  remoteCase(
    "remote-qualified",
    "Is the existing configured route ready through to its child?",
    [
      ["device-runtime", "passed", "Transport available."],
      ["host-runtime", "passed", "Supervisor ready."],
      ["hub", "passed", "Control connection established."],
      ["workspace", "passed", "Expected workspace route matched."],
      ["endpoint", "passed", "Registered child health check succeeded."],
    ],
    "ready",
    "verified-route",
    5,
  ),

  modelCase(
    "local-running",
    "Can I use Cedar locally right now?",
    "cedar",
    "ready",
    "model-ready",
    [
      model("cedar", "ready"),
      model("cedar-large", "error", "too-big", "out of memory"),
    ],
  ),
  modelCase(
    "local-startable",
    "Can Lark start on demand without cloud use?",
    "lark",
    "ready",
    "model-ready",
    [model("lark", "startable", "partial-offload")],
  ),
  modelCase(
    "local-download-active",
    "Can Monarch answer now while its download runs?",
    "monarch",
    "attention",
    "model-in-progress",
    [model("monarch", "downloading")],
  ),
  modelCase(
    "local-is-starting",
    "Is the loading runner ready to serve yet?",
    "sparrow",
    "attention",
    "model-in-progress",
    [model("sparrow", "starting")],
  ),
  modelCase(
    "local-not-installed",
    "Is the offered Sable model already present on disk?",
    "sable",
    "blocked",
    "model-not-installed",
    [model("sable", "not-installed")],
  ),
  modelCase(
    "local-fit",
    "Does the catalog say that Longleaf fits here?",
    "longleaf",
    "blocked",
    "model-does-not-fit",
    [model("longleaf", "not-installed", "too-big")],
  ),
  modelCase(
    "local-exact-slug",
    "Check Cedar-Pro, not the similarly named Cedar.",
    "cedar-pro",
    "inconclusive",
    "model-absent",
    [model("cedar", "ready"), model("cedar-pro-quant", "ready")],
  ),
  modelCase(
    "local-oom",
    "Explain why Juniper failed to load.",
    "juniper",
    "blocked",
    "model-memory",
    [
      model(
        "juniper",
        "error",
        "partial-offload",
        "Out of memory allocating activation buffers while loading weights.",
      ),
    ],
  ),
  modelCase(
    "local-storage",
    "Diagnose Fir's failed local download without retrying.",
    "fir",
    "blocked",
    "model-storage",
    [
      model(
        "fir",
        "error",
        "full-gpu",
        "Could not write model file: no space left on device.",
      ),
    ],
  ),
  modelCase(
    "local-engine",
    "What does the Ash smoke result establish?",
    "ash",
    "blocked",
    "model-engine",
    [
      model(
        "ash",
        "error",
        "full-gpu",
        "The engine process exited before responding to its smoke test.",
      ),
    ],
  ),
  modelCase(
    "local-transfer",
    "Why can't I use Alder yet?",
    "alder",
    "blocked",
    "model-download",
    [
      model(
        "alder",
        "error",
        "full-gpu",
        "Download stopped because the model archive's checksum did not match.",
      ),
    ],
  ),

  logCase(
    "log-app-recovered",
    "Did the renderer recover after the supervision failure?",
    "Renderer",
    [
      [20, "error", "Renderer for attempt 91 failed to attach."],
      [
        21,
        "info",
        "Renderer for attempt 91 successfully reattached and became ready.",
      ],
    ],
    "attention",
    "log-recovered",
    [20, 21],
  ),
  logCase(
    "log-heartbeat-not-recovery",
    "Can a healthy heartbeat resolve the failed report write?",
    "Reports",
    [
      [22, "error", "The report writer could not commit report 7."],
      [23, "info", "Reports scheduler heartbeat OK."],
    ],
    "blocked",
    "log-unresolved",
    [22],
  ),
  logCase(
    "log-mismatched-ticket",
    "Did the successful retry close report 9's failure?",
    "Reports",
    [
      [20, "error", "Report 9 was never committed."],
      [22, "info", "Report 11 retry succeeded and committed."],
    ],
    "blocked",
    "log-unresolved",
    [20],
  ),
  logCase(
    "log-reset",
    "Continue investigation from the prior boot's log cursor.",
    "Build",
    [[22, "error", "Build task refused."]],
    "inconclusive",
    "log-boot-changed",
    [],
    "boot-3",
  ),
  logCase(
    "log-tag-scope",
    "Is there current build evidence since the requested cursor?",
    "Build",
    [
      [19, "error", "Older build step failed."],
      [24, "error", "Delivery stopped.", "Channel"],
    ],
    "inconclusive",
    "log-no-observations",
  ),
  logCase(
    "log-routine-rotation",
    "Check if the visible workspace cycle had a failure.",
    "Workspace",
    [[25, "info", "Workspace closed a completed idle lease normally."]],
    "ready",
    "log-routine",
    [25],
  ),
  logCase(
    "log-original-build-fails",
    "Did the supplied build finish successfully?",
    "Build",
    [
      [20, "info", "Started compilation of candidate."],
      [24, "error", "Compilation failed for candidate."],
    ],
    "blocked",
    "log-unresolved",
    [24],
  ),
  logCase(
    "log-correct-subsystem",
    "Is the queued export still blocked within its own subsystem?",
    "Exporter",
    [
      [20, "error", "Queued export 512 failed storage read."],
      [23, "info", "Export 512 storage read succeeded.", "Notifier"],
    ],
    "blocked",
    "log-unresolved",
    [20],
  ),
  modelIncident(
    "engine-read-log",
    "Check Hemlock and see if its failed engine attach appears in the current host log.",
    model(
      "hemlock",
      "error",
      "full-gpu",
      "The engine exited while attaching the model runner.",
    ),
    {
      serverBootId: "engine-boot",
      latestSeq: 41,
      records: [
        {
          seq: 41,
          timestamp: 41000,
          level: "error",
          tag: "Engine",
          message: "Hemlock runner exited before engine readiness.",
        },
      ],
    },
    "model-engine",
    { code: "log-unresolved", evidenceIds: ["engine-boot:41"] },
  ),
  modelIncident(
    "engine-recovery-is-not-inventory",
    "Has Pecan recovered according to both its local inventory and the host logs?",
    model("pecan", "error", "full-gpu", "The engine stopped before readiness."),
    {
      serverBootId: "engine-boot",
      latestSeq: 48,
      records: [
        {
          seq: 42,
          timestamp: 42000,
          level: "error",
          tag: "Engine",
          message: "Pecan runner smoke probe failed.",
        },
        {
          seq: 48,
          timestamp: 48000,
          level: "info",
          tag: "Engine",
          message: "Pecan runner smoke probe succeeded after retry.",
        },
      ],
    },
    "model-engine",
    {
      code: "log-recovered",
      evidenceIds: ["engine-boot:42", "engine-boot:48"],
    },
  ),
  modelIncident(
    "engine-boot-no-longer-matches",
    "Explain why Chestnut remains unavailable after the host restarted.",
    model(
      "chestnut",
      "error",
      "cpu-only",
      "The engine process crashed during its readiness probe.",
    ),
    { serverBootId: "engine-boot-new", latestSeq: 8, records: [] },
    "model-engine",
    { code: "log-boot-changed", evidenceIds: ["engine-boot-new"] },
  ),
  modelIncident(
    "healthy-engine-skip-log",
    "Check whether Sequoia needs its optional engine log follow-up.",
    model("sequoia", "ready"),
    undefined,
    "model-ready",
  ),
];
