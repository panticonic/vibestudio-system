import {remoteGatewayIdentity} from "natlang:services";
import type {RemoteGatewayIdentity} from "../types.js";
/** Read the authenticated gateway identity behind the assigned route. */
export default async function readGatewayIdentity(operationId: string):Promise<RemoteGatewayIdentity>{
 return remoteGatewayIdentity.observe(operationId);
}
