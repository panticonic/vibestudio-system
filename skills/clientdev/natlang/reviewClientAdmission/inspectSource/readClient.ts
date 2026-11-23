import {clientAdmissionRead} from "natlang:services";
import type {ClientAdmissionObservation} from "../../types.js";
/** Get the assigned client's semantic source, published System trust, host profile and build entry. */
export default async function readClient(operationId: string):Promise<ClientAdmissionObservation>{
 return clientAdmissionRead.observe(operationId);
}
