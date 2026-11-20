export type OperatorIdentity = {
  serverId: string;
  bootId: string;
  buildId: string;
  workspaceId: string;
};
export type OperatorGrant = "start" | "restart" | "pair";
export type OperatorTarget = {
  id: string;
  label: string;
  surface: "deployment" | "terminal-profile";
  grant: OperatorGrant | null;
};
export type OperatorAction =
  | "inspect"
  | "ensure-ready"
  | "restart"
  | "inspect-profile"
  | "pair";
export type OperatorChoice = { targetId: string; action: OperatorAction };
export type OperatorBaseline = {
  target: OperatorTarget;
  state: "ready" | "inactive" | "unverified";
  identity: OperatorIdentity | null;
  receipt: string;
};
export type OperatorAttempt = {
  state: "applied" | "failed" | "baseline-changed";
  receipt: string;
};
export type OperatorReadback = {
  state: "verified" | "unready" | "unchanged-boot" | "identity-changed";
  identity: OperatorIdentity | null;
  receipt: string;
};
export type OperatorProfile = {
  state: "unpaired" | "account" | "workspace" | "foreign" | "unusable";
  inviteAssigned: boolean;
  receipt: string;
};
export type OperatorPair = { state: "paired" | "failed"; receipt: string };
export type OperatorRoute = { state: "routed" | "failed"; receipt: string };
export type OperatorChild = {
  state: "verified" | "unreachable" | "identity-mismatch";
  workspaceId: string | null;
  receipt: string;
};
export type OperatorStatus =
  | "ready"
  | "inactive"
  | "unverified"
  | "deployed"
  | "restarted"
  | "held"
  | "unpaired"
  | "paired";
export type OperatorReason =
  | "approval-required"
  | "prior-identity-required"
  | "unknown-target"
  | "baseline-unverified"
  | "baseline-changed"
  | "installer-failed"
  | "readiness-unverified"
  | "boot-unchanged"
  | "identity-changed"
  | "profile-not-admitted"
  | "route-unverified";
export type OperatorReport = {
  status: OperatorStatus;
  reason: OperatorReason | null;
  targetId: string | null;
  identity: OperatorIdentity | null;
  evidenceIds: string[];
};
export type DeploymentDecision =
  | { kind: "apply"; operation: "start" | "restart" }
  | { kind: "report"; status: OperatorStatus; reason: OperatorReason | null };
