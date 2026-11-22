import { expect, it, vi } from "vitest";
import { prepareLocalModelComparison } from "./live.js";
vi.mock("./index.js", () => ({ readLocalModelInventory: async () => [] }));

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
