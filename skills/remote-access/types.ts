/** Which layer of a Vibestudio remote setup a failure belongs to. */
export type RemoteLayer =
  | "healthy"
  | "client-runtime"
  | "host-sandbox"
  | "server-deployment"
  | "device-credential"
  | "relay-config"
  | "hub-control"
  | "workspace-routing"
  | "child-endpoint";

export type RemoteAccessRequest = { operationId: string };
export type RemoteProfileRead = {
  receipt: string;
  state: "unpaired" | "account" | "workspace" | "foreign" | "unusable";
  inviteAssigned: boolean;
};
export type RemotePairReceipt = {
  receipt: string;
  state: "paired" | "failed";
};
export type RemoteRouteReceipt = {
  receipt: string;
  state: "routed" | "failed";
};
export type RemoteChildReceipt = {
  receipt: string;
  state: "verified" | "unreachable" | "identity-mismatch";
  workspaceId: string | null;
};
export type RemoteAccessDisposition =
  | "workspace-ready"
  | "invite-required"
  | "different-profile"
  | "recover-profile"
  | "pairing-failed"
  | "route-unavailable"
  | "child-unreachable"
  | "child-identity-mismatch";
export type RemoteAccessReport = {
  status: RemoteAccessDisposition;
  workspaceId: string | null;
  evidenceIds: string[];
};

export type RemoteDeploymentRequest = { operationId: string };
export type DeploymentIdentity = {
  serverId: string;
  bootId: string;
  buildId: string;
  workspaceId: string;
};
export type DeploymentBaseline = {
  receipt: string;
  intent: "deploy" | "update";
  hasPriorIdentity: boolean;
  state: "inactive" | "ready" | "unverified";
};
export type DeploymentAction = {
  receipt: string;
  state: "applied" | "failed" | "baseline-changed";
};
export type DeploymentVerification = {
  receipt: string;
  state: "verified" | "unready" | "unchanged-boot" | "identity-changed";
  identity: DeploymentIdentity | null;
};
export type RemoteDeploymentStatus =
  | "already-running"
  | "deployment-ready"
  | "baseline-unverified"
  | "update-needs-existing-server"
  | "installer-failed"
  | "baseline-changed"
  | "readiness-unverified"
  | "boot-unchanged"
  | "server-identity-changed";
export type RemoteDeploymentReport = {
  status: RemoteDeploymentStatus;
  identity: DeploymentIdentity | null;
  evidenceIds: string[];
};

export type RemoteDeploymentHandoff = {
  state: "assigned" | "deployment-changed";
  operationId: string | null;
};

export type RemoteCommissionReport = {
  deployment: RemoteDeploymentReport;
  handoff: RemoteDeploymentHandoff | null;
  access: RemoteAccessReport | null;
};

export type RemoteRouteReviewRequest = {
  goal: string;
  operationId: string;
  serverId: string;
  workspaceId: string;
};

export type RemoteGatewayIdentity = {
  serverId: string;
  bootId: string;
  workspaceId: string;
};

export type RemoteRouteIdentityVerdict = "verified" | "server-mismatch" | "workspace-mismatch";
export type CliContextSource = "session" | "context" | "ambient" | "binding" | "default";
export type CliContextCoordinate = { serverId?: string; workspaceId?: string; contextId: string };
export type CliContextEvidence = {
  gateway: RemoteGatewayIdentity;
  credential: { kind: "device" } | { kind: "agent"; contextId: string };
  operation: "inspect" | "eval" | "edit";
  selectors: {
    session?: CliContextCoordinate;
    context?: CliContextCoordinate;
    ambient?: CliContextCoordinate;
    binding?: CliContextCoordinate;
    default?: CliContextCoordinate;
  };
};
export type CliContextChoice = { source: CliContextSource; coordinate: CliContextCoordinate | null };
export type CliContextStatus = "usable" | "unattached" | "foreign-workspace" | "foreign-context";
export type CliContinuation = {
  source: CliContextSource;
  contextId: string | null;
  status: CliContextStatus;
  gateway: RemoteGatewayIdentity;
};
export type RemoteRouteReview = {
  observed: RemoteGatewayIdentity;
  verdict: RemoteRouteIdentityVerdict;
  layer: RemoteLayer;
  next: "accept-identity" | "verify-server-assignment" | "refresh-workspace-reach";
};
