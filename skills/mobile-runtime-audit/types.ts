export type AndroidDeviceState = "device" | "unauthorized" | "offline";
export type AndroidAuditRequest = {
  goal: string;
  operationId: string;
  target: string;
  intent: "device" | "application";
};
export type AndroidTargetObservation = { target: string; state: AndroidDeviceState | null };
export type AndroidTargetReview = "target-absent" | "target-unauthorized" | "target-offline" | "target-ready";
export type AndroidRuntimeObservation = {
  target: string;
  packageName: string;
  installed: boolean;
  processObserved: boolean;
  screenshotCaptured: boolean;
  screenshotBytes: number;
  issues: string[];
};
export type AndroidRuntimeStatus =
  | "app-absent" | "process-absent" | "screenshot-unavailable" | "workspace-unverified";
export type AndroidImageEvidence = "captured" | "unavailable";
export type AndroidRuntimeReview = {
  observation: AndroidRuntimeObservation;
  status: AndroidRuntimeStatus;
  image: AndroidImageEvidence;
};
export type AndroidAuditReport = {
  targetObservation: AndroidTargetObservation;
  targetReview: AndroidTargetReview;
  runtime: AndroidRuntimeReview | null;
};
