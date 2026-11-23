import {remoteAccessRoute} from "natlang:services";
import type {RemoteRouteReceipt} from "../../types.js";
/** Ask the hub to route the explicitly assigned workspace identity. */
export default async function routeThroughHub(priorReceipt: string):Promise<RemoteRouteReceipt>{
 return remoteAccessRoute.select(priorReceipt);
}
