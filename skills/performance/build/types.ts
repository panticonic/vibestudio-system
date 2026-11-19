export type BuildPerformanceRequest = {
  operationId: string;
  goal: string;
  initialBudgetBytes?: number;
};

export type BuildPhaseTimes = {
  bundlingMs: number;
  validationMs: number;
  otherMs: number;
};

export type BuildPayloadObservation = {
  initialBytes: number;
  lazyBytes: number;
  totalBytes: number;
  largestInitialInputs: { source: string; bytes: number }[];
};

export type BuildPerformanceTarget = {
  target: string;
  buildKey: string;
  artifactBytes: number;
  executableSourceBytes: number;
  payload: BuildPayloadObservation | null;
};

export type BuildPerformanceObservation = {
  source: string;
  stateHash: string;
  status: "ok" | "failed" | "skipped";
  first: {
    elapsedMs: number;
    cacheState: "built-during-profile" | "preexisting" | "unknown";
    phases: BuildPhaseTimes | null;
  };
  repeat: { elapsedMs: number; sameBuildKeys: boolean } | null;
  targets: BuildPerformanceTarget[];
  firstError: { file: string; message: string } | null;
};

export type BuildRunAssessment = {
  state: "built" | "preexisting" | "unknown" | "unavailable";
  repeat: "verified" | "different-keys" | "unavailable";
  phase: "bundling" | "validation" | "other" | "tied" | "unavailable";
};

export type PayloadAssessment = {
  budget: "over" | "within" | "unassigned";
  largestInitialInput: { source: string; bytes: number } | null;
};

export type BuildPerformanceFollowup = {
  action: "diagnose-build" | "establish-cache" | "reduce-initial-payload" | "measure-phase" | "record-baseline";
  reason: string;
};

export type BuildPerformanceReport = {
  observation: BuildPerformanceObservation;
  execution: BuildRunAssessment;
  payload: PayloadAssessment | null;
  next: BuildPerformanceFollowup;
};
