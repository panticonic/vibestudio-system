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
  | SystemLogInput
  | SystemClientSurfaceInput;

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

export type SystemInteractionAudit = {
  surface: "desktop-browser" | "mobile-browser";
  start: { id: string; workspace: string };
  receipts: {
    id: string;
    kind: "operation" | "completion" | "notification";
    workspace: string;
  }[];
};

export type SystemPairingAudit = {
  invite: { id: string; deepLink: string | null; room: string | null };
  receipts: {
    id: string;
    kind: "paired" | "expired" | "cancelled" | "devices-polled";
    inviteId: string | null;
  }[];
};

export type SystemBootstrapAudit = {
  platform: "android" | "ios";
  expectation: { abi: string; build: string; provider: string };
  manifest: { id: string; abi: string; build: string; provider: string | null };
  artifacts: {
    id: string;
    platform: "android" | "ios";
    role: "primary" | "support";
    expectedIntegrity: string;
    observedIntegrity: string | null;
  }[];
};

export type SystemMobileProbeAudit = {
  target:
    | "android-device"
    | "android-emulator"
    | "ios-simulator"
    | "ios-device";
  expectedAttempt: string;
  receipts: {
    id: string;
    attempt: string;
    kind: "installed" | "launched" | "workspace-ready" | "log-stream";
    backend: "adb" | "simctl" | "device-console";
    outcome: "observed" | "failed";
  }[];
};

export type SystemClientSurfaceInput =
  | {
      kind: "client-surface";
      goal: string;
      audit: "workspace-interaction";
      observation: SystemInteractionAudit;
    }
  | {
      kind: "client-surface";
      goal: string;
      audit: "pairing";
      observation: SystemPairingAudit;
    }
  | {
      kind: "client-surface";
      goal: string;
      audit: "bootstrap";
      observation: SystemBootstrapAudit;
    }
  | {
      kind: "client-surface";
      goal: string;
      audit: "mobile-probe";
      observation: SystemMobileProbeAudit;
    };
