import type {
  RemoteProfileRead,
  RemotePairReceipt,
  RemoteRouteReceipt,
  RemoteChildReceipt,
} from "./types.js";

declare module "natlang:services" {
  export const remoteAccessRead: { observe(operationId: string): Promise<RemoteProfileRead> };
  export const remoteAccessPair: { pair(profileReceipt: string): Promise<RemotePairReceipt> };
  export const remoteAccessRoute: { select(priorReceipt: string): Promise<RemoteRouteReceipt> };
  export const remoteAccessVerify: { verify(routeReceipt: string): Promise<RemoteChildReceipt> };
}
