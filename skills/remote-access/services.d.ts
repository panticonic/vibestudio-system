import type {
  RemoteProfileRead,
  RemotePairReceipt,
  RemoteRouteReceipt,
  RemoteChildReceipt,
  DeploymentBaseline,
  DeploymentAction,
  DeploymentVerification,
} from "./types.js";

declare module "natlang:services" {
  export const remoteDeploymentRead: { observe(operationId: string): Promise<DeploymentBaseline> };
  export const remoteDeploymentApply: { apply(baselineReceipt: string): Promise<DeploymentAction> };
  export const remoteDeploymentVerify: { verify(actionReceipt: string): Promise<DeploymentVerification> };
  export const remoteAccessRead: { observe(operationId: string): Promise<RemoteProfileRead> };
  export const remoteAccessPair: { pair(profileReceipt: string): Promise<RemotePairReceipt> };
  export const remoteAccessRoute: { select(priorReceipt: string): Promise<RemoteRouteReceipt> };
  export const remoteAccessVerify: { verify(routeReceipt: string): Promise<RemoteChildReceipt> };
}
