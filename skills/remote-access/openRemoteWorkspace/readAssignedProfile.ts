import {remoteAccessRead} from "natlang:services";
import type {RemoteProfileRead} from "../types.js";
/** Read the current state of the caller-assigned device profile. */
export default async function readAssignedProfile(operationId: string):Promise<RemoteProfileRead>{
 return remoteAccessRead.observe(operationId);
}
