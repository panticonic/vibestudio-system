declare module "natlang:services" {
  export const remoteGatewayIdentity: {
    observe(operationId: string): Promise<import("./types.js").RemoteGatewayIdentity>;
  };
  export const remoteCliScope: {
    evidence(operationId: string): Promise<import("./types.js").CliContextEvidence>;
  };

  export const remoteDeploymentRead: { observe(operationId: string): Promise<import("./types.js").DeploymentBaseline> };
  export const remoteDeploymentApply: { apply(baselineReceipt: string): Promise<import("./types.js").DeploymentAction> };
  export const remoteDeploymentVerify: { verify(actionReceipt: string): Promise<import("./types.js").DeploymentVerification> };
  export const remoteDeploymentHandoff: { open(deploymentReceipt: string): Promise<import("./types.js").RemoteDeploymentHandoff> };
  export const remoteAccessRead: { observe(operationId: string): Promise<import("./types.js").RemoteProfileRead> };
  export const remoteAccessPair: { pair(profileReceipt: string): Promise<import("./types.js").RemotePairReceipt> };
  export const remoteAccessRoute: { select(priorReceipt: string): Promise<import("./types.js").RemoteRouteReceipt> };
  export const remoteAccessVerify: { verify(routeReceipt: string): Promise<import("./types.js").RemoteChildReceipt> };
}
