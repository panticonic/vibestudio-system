import {remoteAccessVerify} from "natlang:services";
import type {RemoteChildReceipt} from "../../types.js";
/** Independently verify the child reached through the selected route. */
export default async function observeChild(routeReceipt: string):Promise<RemoteChildReceipt>{
 return remoteAccessVerify.verify(routeReceipt);
}
