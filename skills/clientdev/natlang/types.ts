export type ClientAdmissionRequest = { goal: string; operationId: string };
export type ClientContract = {
  hash: string;
  id: string;
  runtime: string;
  abi: string;
  required: string[];
  optional: string[];
};
export type ClientAdmissionObservation = {
  operationId: string;
  contextId: string;
  source: string;
  workingRevision: string;
  mainRevision: string;
  working: ClientContract;
  published: ClientContract;
  trusted: boolean;
  host: {
    kind: "desktop" | "terminal" | "android" | "ios";
    runtimes: Record<string, string>;
    capabilities: string[];
    deviceLevel: string[];
  };
  catalog: {
    status: "available" | "building" | "ready" | "approval-required" | "error";
    source: string;
    effectiveVersion: string | null;
    activeBuildKey: string | null;
  } | null;
};
export type ClientSourceReview = {
  observation: ClientAdmissionObservation;
  disposition: "working-change" | "published-contract";
};
export type ClientCapabilityReview = {
  missingRequired: string[];
  untrustedRequired: string[];
  deniedOptional: string[];
};
export type ClientHostReview = {
  abi: "compatible" | "wrong-runtime" | "wrong-abi";
  capabilities: ClientCapabilityReview;
};
export type ClientDecision =
  | "match-runtime"
  | "resolve-abi"
  | "resolve-required-capabilities"
  | "review-candidate"
  | "check-declaration"
  | "await-build"
  | "await-approval"
  | "inspect-build"
  | "reviewed-ready";
export type ClientAdmissionReview = {
  source: ClientSourceReview;
  host: ClientHostReview;
  decision: ClientDecision;
};
