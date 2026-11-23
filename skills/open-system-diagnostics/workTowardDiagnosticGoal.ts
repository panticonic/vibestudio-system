import {diagnosticCatalog} from "natlang:services";
import chooseCheckpoints from "./workTowardDiagnosticGoal/chooseCheckpoints.nl";
import readWindow from "./workTowardDiagnosticGoal/readWindow.js";
import reconsider from "./workTowardDiagnosticGoal/reconsider.nl";
import decideOutcome from "./workTowardDiagnosticGoal/decideOutcome.nl";
import bindReport from "./workTowardDiagnosticGoal/bindReport.js";
import stageHandoff from "./workTowardDiagnosticGoal/stageHandoff.js";
import type {DiagnosticReport,Inspection} from "./types.js";
export default async function workTowardDiagnosticGoal(goal:string):Promise<DiagnosticReport>{
 const catalog=await diagnosticCatalog.discover(),selected=await chooseCheckpoints(goal,catalog.checkpoints);
 const inspections:Inspection[]=[];
 for(const sourceId of selected)inspections.push(await readWindow(goal,sourceId));
 for(let remaining=2;remaining>0;remaining--){
  const next=await reconsider(goal,catalog.checkpoints,inspections);
  if(next===null||inspections.some(item=>item.window.source.id===next))break;
  if(!catalog.checkpoints.some(item=>item.id===next))throw new Error("The diagnostic continuation is outside the authorized catalog");
  inspections.push(await readWindow(goal,next));
 }
 const decision=await decideOutcome(goal,inspections,catalog.mayStage),report=bindReport(decision,inspections);
 return {...report,artifact:decision.stage&&catalog.mayStage&&report.finding.citations.length?await stageHandoff(report.finding):null};
}
