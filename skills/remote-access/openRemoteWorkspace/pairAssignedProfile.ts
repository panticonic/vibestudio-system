import {remoteAccessPair} from "natlang:services";
import type {RemotePairReceipt} from "../types.js";
/** Redeem the caller's assigned invitation for the assigned profile. */
export default async function pairAssignedProfile(profileReceipt: string):Promise<RemotePairReceipt>{
 return remoteAccessPair.pair(profileReceipt);
}
