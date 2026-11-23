import {remoteDeploymentVerify} from "natlang:services";
import type {DeploymentVerification} from "../../types.js";
/** Read independent readiness and identity evidence for the assigned installer attempt. */
export default async function observeReadiness(actionReceipt: string):Promise<DeploymentVerification>{
 return remoteDeploymentVerify.verify(actionReceipt);
}
