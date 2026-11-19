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
