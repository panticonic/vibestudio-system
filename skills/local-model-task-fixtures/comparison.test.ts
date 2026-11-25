import { expect, it } from "vitest";
import type { LocalModelEntry } from "@workspace/model-catalog/localModels";
import { prepareLocalModelComparison } from "../local-model-task-bindings/live.js";

function model(
  slug: string,
  contextWindow: number,
  toolsCapable: boolean,
): LocalModelEntry {
  return {
    slug,
    displayName: slug,
    baseUrl: "http://localhost:8080",
    server: "main",
    maxTokens: contextWindow,
    contextWindow,
    toolsCapable,
    reasoningCapable: false,
    fit: {
      fit: "cpu-only",
      estTokensPerSec: null,
      contextLength: contextWindow,
      gpuLayers: 0,
      notes: [],
    },
    measuredTokensPerSec: null,
    state: "startable",
    download: null,
    errorMessage: null,
  };
}

it("keeps every assigned observation and selects the first eligible fork handoff", async () => {
  const refs = [
    "local:gone",
    "local:no-tools",
    "local:tiny",
    "local:usable",
    "local:later",
  ] as const;
  const inventory = [
    model("no-tools", 32768, false),
    model("tiny", 4096, true),
    model("usable", 32768, true),
    model("later", 65536, true),
  ];
  const methods: string[] = [];
  const prepared = await prepareLocalModelComparison(
    {
      async invoke(_extension, method) {
        methods.push(method);
        return inventory;
      },
    },
    "comparison-context",
    {
      id: "fork-check",
      request: {
        goal: "Continue the repository audit",
        operation: "compare",
        modelRef: refs[0],
        alternatives: refs.slice(1),
        mayInstall: false,
        needsTools: true,
        minimumContext: 16_000,
        requiresPriorConversation: true,
      },
    },
  );
  for (const ref of refs)
    await prepared.services.localModelTaskInventory.inspect(ref);

  expect(Object.keys(prepared.services)).toEqual(["localModelTaskInventory"]);
  const after = await prepared.readback();
  expect([...new Set(methods)]).toEqual(["listModels"]);
  expect(
    prepared.expected.candidates?.map(({ disposition }) => disposition),
  ).toEqual([
    "unavailable",
    "unsupported-tools",
    "context-too-small",
    "ready-to-delegate",
    "ready-to-delegate",
  ]);
  expect(prepared.expected.handoff).toEqual({
    ref: "local:usable",
    mode: "fork",
  });
  expect(prepared.verify(prepared.expected, after).passed).toBe(true);
  expect(
    prepared.verify(
      { ...prepared.expected, handoff: { ref: "local:later", mode: "fork" } },
      after,
    ).passed,
  ).toBe(false);
  await expect(
    prepared.services.localModelTaskInventory.inspect("local:outside"),
  ).rejects.toThrow("only the assigned");
});
