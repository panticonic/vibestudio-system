import {remoteDeploymentApply} from "natlang:services";
import type {DeploymentAction} from "../types.js";
/** Run the caller-authorized installer using the observed baseline receipt. */
export default async function applyDeployment(baselineReceipt: string):Promise<DeploymentAction>{
 return remoteDeploymentApply.apply(baselineReceipt);
}
