import {createHash} from "node:crypto";
import {expect, it, vi} from "vitest";
const state=vi.hoisted(()=>({files:new Map<string,string>()}));
vi.mock("@vibestudio/content-addressing",()=>({sha256HexSyncText:(text:string)=>createHash("sha256").update(text).digest("hex")}));
vi.mock("@vibestudio/service-schemas/mainRpc",()=>({mainRpcMethods:{"serverLog.query":"serverLog.query"}}));
vi.mock("@workspace/runtime",()=>({contextId:"owned",fs:{mkdtemp:async()=>"scratch",writeFile:async(path:string,text:string)=>{state.files.set(path,text);},readFile:async(path:string)=>state.files.get(path)},rpc:{call:async(_target:string,_method:string,args:any[])=>({serverBootId:"boot",workspaceId:"workspace",latestSeq:2,records:args[0].sinceSeq===undefined?[]:[{seq:1,message:"case Import failed before commit"},{seq:2,message:"case Import committed after retry"}]})}}));
vi.mock("@workspace-skills/server-log-cursor-bindings",()=>({bindServerLogCursor:()=>({request:{operationId:"cursor"},services:{serverLogCursor:{observe:async()=>({liveBoot:"boot",latestSeq:2,oldestSeq:1,throughSeq:2,overflow:false,snapshot:{records:[{seq:1,message:"case Import failed before commit"},{seq:2,message:"case Import committed after retry"}]}})}}})}));
import {prepareOpenSystemDiagnostics} from "./managed.js";
async function fixture(){
 const world={id:"diagnostic",goal:"Did the import recover? Leave a local handoff with evidence.",lines:["Import failed before commit","Import committed after retry"],checkpoints:[{key:"retry",label:"Retry",component:"Import",description:"Actual retry",first:0,last:1}],mayStage:true,expected:{windows:{retry:"observed" as const},status:"recovered" as const,citations:[["retry",0],["retry",1]] as const,stage:true,mentions:[["hidden-reference-phrase"]]}};
 const prepared=await prepareOpenSystemDiagnostics({contextId:"owned",caseId:world.id},world,{marker:"case",boot:"boot",workspaceId:"workspace",start:0,steps:[1,2]});
 const catalog=await prepared.services.diagnosticCatalog.discover();
 const window=await prepared.services.diagnosticLog.read(catalog.checkpoints[0]!.id);
 const finding={status:"recovered" as const,reason:"The retry settled the import. ".repeat(80),citations:[{sourceId:window.source.id,boot:"boot",seq:2,text:world.lines[1]!}]};
 const artifact=await prepared.services.diagnosticHandoff.stage(finding);
 return {prepared,world,window,finding,artifact};
}
it("accepts a genuine differently worded, longer finding with a sufficient subset of actual citations for bound meaning review",async()=>{
 const f=await fixture();const report={finding:f.finding,coverage:[],artifact:f.artifact};
 const proof=await f.prepared.verify(report);
 expect(proof.passed).toBe(true);
 expect(proof.semanticReviewRequired).toBe(true);
 expect(proof.semanticReviewInput.actual).toEqual({goal:f.world.goal,observations:{catalog:{checkpoints:[f.window.source],mayStage:true},windows:[f.window]},artifacts:{handoffReadback:state.files.get(f.artifact.path)},requestedReturn:report});
 expect(JSON.stringify(proof.semanticReviewInput)).not.toContain("hidden-reference-phrase");
});
it("rejects forged citations and coverage while retaining authentic windows for semantic assessment",async()=>{
 const f=await fixture();
 expect((await f.prepared.verify({finding:{...f.finding,citations:[{...f.finding.citations[0],text:"fabricated"}]},coverage:[],artifact:f.artifact})).checks.groundedDiagnosticCitations).toBe(false);
 expect((await f.prepared.verify({finding:f.finding,coverage:[{sourceId:"foreign",status:"observed",liveBoot:"boot",through:2}],artifact:f.artifact})).checks.preservedDiagnosticBootCoverage).toBe(false);
 state.files.set(f.artifact.path,"changed retained bytes");
 expect((await f.prepared.verify({finding:f.finding,coverage:[],artifact:f.artifact})).checks.verifiedDiagnosticHandoff).toBe(false);
});
it("qualifies with actual native log text rather than private answer vocabulary",async()=>{
 const world={id:"reference",goal:"Check whether the retry settled and leave a local evidence note.",lines:["Import failed before commit","Import committed after retry"],checkpoints:[{key:"retry",label:"Retry",component:"Import",description:"Actual retry",first:0,last:1}],mayStage:true,expected:{windows:{retry:"observed" as const},status:"recovered" as const,citations:[["retry",1]] as const,stage:true,mentions:[["hidden-reference-phrase"]]}};
 const prepared=await prepareOpenSystemDiagnostics({contextId:"owned",caseId:world.id},world,{marker:"case",boot:"boot",workspaceId:"workspace",start:0,steps:[1,2]});
 const proof=await prepared.qualify();
 expect(proof.passed).toBe(true);expect(proof.handoffReadback).toContain("Import committed after retry");
 expect(proof.handoffReadback).not.toContain("hidden-reference-phrase");
});
