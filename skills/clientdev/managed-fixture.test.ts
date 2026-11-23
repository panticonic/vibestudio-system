import { expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ head: "main", reads: 0 }));
vi.mock("@workspace/runtime", () => ({ vcs: { status: async () => ({ mainEventId: "main", workingHead: { kind: "event", eventId: state.head } }) } }));
const observation = { operationId: "owned-operation", contextId: "owned", source: "clients/owned", mainRevision: "main", workingRevision: "main",
  working: { runtime: "node", abi: "1", hash: "same", required: [], optional: [] },
  published: { runtime: "node", abi: "1", hash: "same", required: [], optional: [] }, trusted: true,
  host: { kind: "node", runtimes: { node: "1" }, capabilities: [], deviceLevel: [] },
  catalog: { source: "clients/owned", status: "ready" } };
vi.mock("./workflow.js", () => ({ bindClientAdmission: () => ({ request: { operationId: "owned-operation" }, services: {
  clientAdmissionRead: { async observe(id: string) { if (id !== "owned-operation") throw new Error("assigned System client"); state.reads++; return structuredClone(observation); } },
} }) }));
import { prepareManagedClientAdmission } from "./managed-fixture.js";
it("accepts an issued native observation after repeated reads and rejects foreign/stale evidence", async () => {
  const prepared = await prepareManagedClientAdmission("owned", { id: "review", source: "clients/owned", host: "node", goal: "Review the owned client contract", runtime: "node", publishedAbi: "1", workingAbi: "1", abi: "compatible" } as never);
  const result = await prepared.qualify();
  expect(result.verification.passed).toBe(true);
  await prepared.services.clientAdmissionRead.observe(prepared.request.operationId);
  await prepared.services.clientAdmissionRead.observe(prepared.request.operationId);
  const report = { source: { observation, disposition: "published-contract" }, host: { abi: "compatible", capabilities: { missingRequired: [], untrustedRequired: [], deniedOptional: [] } }, decision: "reviewed-ready" };
  expect((await prepared.verify(report as never)).passed).toBe(true);
  expect((await prepared.verify({ ...report, source: { ...report.source, observation: { ...observation, contextId: "foreign" } } } as never)).passed).toBe(false);
  await expect(prepared.services.clientAdmissionRead.observe("foreign")).rejects.toThrow("assigned");
  state.head = "changed";
  expect((await prepared.verify(report as never)).passed).toBe(false);
});
