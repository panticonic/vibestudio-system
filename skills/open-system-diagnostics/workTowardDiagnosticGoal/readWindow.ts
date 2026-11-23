import {diagnosticLog} from "natlang:services";
import interpretWindow from "./readWindow/interpretWindow.nl";
import type {Inspection} from "../types.js";
export default async function readWindow(goal:string,sourceId:string):Promise<Inspection>{
 const window=await diagnosticLog.read(sourceId);
 return {window,reading:await interpretWindow(goal,window)};
}
