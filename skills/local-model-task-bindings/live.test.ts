import { beforeEach, expect, it, vi } from "vitest";
import { prepareLocalModelComparison } from "./live.js";
const native=vi.hoisted(()=>({rows:[] as any[]}));
vi.mock("./index.js", () => ({ readLocalModelInventory: async () => structuredClone(native.rows) }));
beforeEach(()=>{native.rows=[];});

it("requires candidate coverage while permitting repeated and reordered observations", async () => {
  const comparison = await prepareLocalModelComparison({} as never, "context", {
    id: "comparison", request: { goal: "Compare local candidates", modelRef: "local:a", alternatives: ["local:b"],
      operation: "compare", mayInstall: false, needsTools: true, minimumContext: 4096, requiresPriorConversation: false },
  });
  await comparison.services.localModelTaskInventory.inspect("local:b");
  expect(comparison.verify(comparison.expected, await comparison.readback()).passed).toBe(false);
  await comparison.services.localModelTaskInventory.inspect("local:b");
  await comparison.services.localModelTaskInventory.inspect("local:a");
  const reverse = { ...comparison.expected, candidates: comparison.expected.candidates?.toReversed() };
  expect(comparison.verify(reverse, await comparison.readback()).passed).toBe(true);
  await expect(comparison.services.localModelTaskInventory.inspect("local:foreign")).rejects.toThrow("assigned");
});

it("refreshes actual catalog states and rejects stale findings until a fresh authorized observation",async()=>{
 const row=(slug:string,state:string)=>({slug,state,fit:{fit:"cpu-only"},toolsCapable:true,contextWindow:32768,download:null,errorMessage:null});
 native.rows=[row("a","not-installed"),row("b","ready")];
 const comparison=await prepareLocalModelComparison({} as never,"context",{id:"current",request:{goal:"Compare current local candidates",modelRef:"local:a",alternatives:["local:b"],operation:"compare",mayInstall:false,needsTools:true,minimumContext:4096,requiresPriorConversation:false}});
 expect((await comparison.services.localModelTaskInventory.inspect("local:a"))?.state).toBe("not-installed");
 await comparison.services.localModelTaskInventory.inspect("local:b");
 expect(comparison.expected.ref).toBe("local:b");
 native.rows[0]!.state="ready";
 expect(comparison.verify(comparison.expected,await comparison.readback()).checks.currentInventory).toBe(false);
 const actual=await comparison.services.localModelTaskInventory.inspect("local:a");expect(actual?.state).toBe("ready");
 expect(comparison.expected.ref).toBe("local:a");expect(comparison.verify(comparison.expected,await comparison.readback()).passed).toBe(true);
 actual!.state="error";
 expect(comparison.verify(comparison.expected,await comparison.readback()).passed).toBe(true);
 native.rows[0]!.state="downloading";
 expect(comparison.verify(comparison.expected,await comparison.readback()).passed).toBe(false);
 await comparison.services.localModelTaskInventory.inspect("local:a");
 const proof=comparison.verify(comparison.expected,await comparison.readback());expect(proof.passed).toBe(true);expect(proof.expected.ref).toBe("local:b");
 expect(proof.observations.map(row=>row.row?.state)).toEqual(["not-installed","ready","ready","downloading"]);
});
