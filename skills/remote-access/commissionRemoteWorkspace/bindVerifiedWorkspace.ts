import {remoteDeploymentHandoff} from "natlang:services";
import type {RemoteDeploymentHandoff} from "../types.js";
/** Bind the assigned device profile to the workspace verified by the deployment run. */
export default async function bindVerifiedWorkspace(deploymentReceipt: string):Promise<RemoteDeploymentHandoff>{
 return remoteDeploymentHandoff.open(deploymentReceipt);
}
