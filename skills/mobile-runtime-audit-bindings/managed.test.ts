import {createHash} from "node:crypto";
import {expect,it,vi} from "vitest";
import {prepareOpenAndroidAudit} from "./managed.js";
import {observeInvocation} from "@workspace-skills/system-testing/observed-invocation";
vi.mock("@vibestudio/content-addressing",()=>({sha256HexSyncText:(text:string)=>createHash("sha256").update(text).digest("hex")}));
const world={id:"target-check",goal:"Inspect the assigned disposable device",mode:"target" as const};
async function prepared(){
 return prepareOpenAndroidAudit({contextId:"owned",caseId:world.id,goal:world.goal},world,
  async()=>[{serial:"emulator-5554",state:"device"}],assignment=>({request:{...assignment,operationId:"owned-audit"},services:{androidRuntimeAudit:{
   observeTarget:async()=>({target:assignment.target,state:"device"}),
   observeApplication:async()=>{throw Error("Read-only target audit must not inspect the application");},
  }}}));
}
it("separates actual device observations from a wrong required answer without invented source identities",async()=>{
 const audit=await prepared();expect((await audit.qualify()).passed).toBe(true);
 const wrong=await audit.verify({});
 expect(wrong.outcomeDimensions.effects.passed).toBe(true);
 expect(wrong.outcomeDimensions.returnedValue.passed).toBe(false);expect(wrong.passed).toBe(false);
 expect(wrong.outcomeDimensions.incidentalValues?.incorrectReturns).toEqual([]);
});
it("binds an incorrect Android finding to the actual sampled imported NL producer",async()=>{
 const audit=await prepared();await audit.qualify();const value={},valueJson=JSON.stringify(value),hash=createHash("sha256").update(valueJson).digest("hex");
 const rows=[{id:"root",parent:null,kind:"crisp",name:"auditAndroidGoal",source:"auditAndroidGoal.ts"},{id:"actual-producer",parent:"root",kind:"agent",name:"auditAndroidRuntime",source:"auditAndroidGoal/installed/auditAndroidRuntime.nl"}];
 const invocation=observeInvocation({evalRunId:"reference",captureErrors:[],rootCallIds:["root"],calls:rows.map(row=>({callId:row.id,summary:{run_id:"reference",owner_key:"owned",owner_kind:"eval"},record:{call_id:row.id,parent_call_id:row.parent,definition:{name:row.name,source:row.source},executor:{kind:row.kind,model_id:row.kind==="agent"?"test:offline":null},cost:{model_requests:row.kind==="agent"?1:0},outcome:"done",output:{complete:true,hash}}}))},async reference=>reference===hash?valueJson:null);
 const wrong=await audit.verify(value,invocation);
 expect(wrong.outcomeDimensions.effects.passed).toBe(true);
 expect(wrong.outcomeDimensions.incidentalValues?.incorrectReturns).toContainEqual(expect.objectContaining({definition:{name:"auditAndroidRuntime",source:"auditAndroidGoal/installed/auditAndroidRuntime.nl"},required:true,valueJson,contribution:expect.objectContaining({producer_call_id:"actual-producer"})}));
});
