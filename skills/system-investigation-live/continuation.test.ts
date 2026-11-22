import { expect, it, vi } from "vitest";
import { prepareIncidentContinuation } from "./continuation.js";
import { prepareManagedLogAudit, workerdLogTag } from "./live.js";

vi.mock("@workspace-skills/local-model-task-bindings/live", () => ({
  prepareLocalModelComparison: async () => ({
    expected: { ref: "local:a" },
    services: { localModelTaskInventory: { inspect: async () => null } },
    readback: async () => [],
    verify: (report: { ref?: string } | null) => ({ passed: report?.ref === "local:a" }),
  }),
}));

it("composes independent domain evidence without imposing a call or result order", async () => {
  const log = prepareManagedLogAudit(async () => ({
    workspaceId: "workspace", serverBootId: "boot", latestSeq: 1,
    records: [{ seq: 1, timestamp: 1, level: "info", tag: workerdLogTag, message: "owned current" }],
  }), "context", { id: "incident", goal: "Review incident and local capacity", lines: ["current"], windows: [
    { title: "incident", cursor: null, tag: workerdLogTag, status: "ready", code: "current", evidence: [0] },
  ] }, { marker: "owned", boot: "boot", workspaceId: "workspace", start: 0, steps: [1] });
  const continuation = prepareIncidentContinuation("context", "incident", log.request.goal, log, {} as never, {
    id: "models", request: { operation: "compare", modelRef: "local:a", alternatives: ["local:b"] } as never,
  });
  await expect(continuation.services.localModelTaskInventory.inspect("foreign")).rejects.toThrow("assigned");
  await continuation.services.localModelTaskInventory.inspect("local:b");
  await continuation.services.serverLog.query({ sinceSeq: 0, tag: workerdLogTag, limit: 100 });
  await continuation.services.localModelTaskInventory.inspect("local:a");
  await continuation.services.serverLog.query({ sinceSeq: 0, tag: workerdLogTag, limit: 100 });
  const result = await continuation.verify({ remaining: [], results: [
    { kind: "domain", domain: "localModel", operation: "prepareLocalModel", report: { ref: "local:a" } },
    { kind: "domain", domain: "system", operation: "investigateSystem", report: log.expected },
  ] });
  expect(result.verification.passed).toBe(true);
});
