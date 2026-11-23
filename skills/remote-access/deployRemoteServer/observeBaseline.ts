import {remoteDeploymentRead} from "natlang:services";
import type {DeploymentBaseline} from "../types.js";
/** Read the assigned managed deployment baseline and requested operation. */
export default async function observeBaseline(operationId: string):Promise<DeploymentBaseline>{
 return remoteDeploymentRead.observe(operationId);
}
