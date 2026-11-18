export type SystemStatus = "ready" | "blocked" | "inconclusive" | "attention";

export type SystemFinding = {
  code: string;
  evidenceIds: string[];
};

export type SystemInvestigationReport = {
  status: SystemStatus;
  findings: SystemFinding[];
};

export type SystemPerformanceRun = {
  id: string;
  boundary: "panel-action" | "workspace-boot" | "build" | "agent-reply";
  cache: "cold" | "warm";
  workload: string;
  elapsedMs: number[];
};

export type SystemClientEvidence = {
  id: string;
  stage: "build" | "activation" | "runtime" | "user-check";
  state: "passed" | "failed" | "skipped";
  revision: string;
  detail: string;
};

export type SystemRemoteEvidence = {
  id: string;
  phase: "device-runtime" | "host-runtime" | "hub" | "workspace" | "endpoint";
  state: "passed" | "failed" | "skipped";
  detail: string;
};

export type SystemPerformanceInput = {
  kind: "performance";
  goal: string;
  baseline: SystemPerformanceRun;
  candidate: SystemPerformanceRun;
  regressionBudgetPercent: number;
};
export type SystemClientInput = {
  kind: "client-development";
  goal: string;
  revision: string;
  checks: SystemClientEvidence[];
};
export type SystemRemoteInput = {
  kind: "remote-access";
  goal: string;
  checks: SystemRemoteEvidence[];
};
export type SystemModelsInput = {
  kind: "model-readiness";
  goal: string;
  slug: string;
  incidentLog: SystemLogInput | null;
};
export type SystemLogInput = {
  kind: "server-log-incident";
  goal: string;
  expectedBoot: string;
  sinceSeq: number;
  tag: string;
};
export type SystemInvestigationRequest =
  | SystemPerformanceInput
  | SystemClientInput
  | SystemRemoteInput
  | SystemModelsInput
  | SystemLogInput;

export type SystemPerformanceComparison = {
  verdict:
    | "within-budget"
    | "regression"
    | "incomparable"
    | "insufficient-samples";
  changePercent: number | null;
};

export type SystemModelObservation = {
  slug: string;
  state:
    | "ready"
    | "startable"
    | "not-installed"
    | "starting"
    | "downloading"
    | "error";
  errorMessage: string | null;
  fit: { fit: "full-gpu" | "partial-offload" | "cpu-only" | "too-big" };
};

export type SystemLogRecord = {
  seq: number;
  timestamp: number;
  level: "verbose" | "info" | "warn" | "error";
  tag?: string;
  message: string;
};
