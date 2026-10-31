import { describe, expect, it } from "vitest";
import {
  effectiveModelRuntime,
  modelRuntimeArgs,
  validatedRuntimeConfig,
  runtimeContextLengthFor,
  stockServingRequest,
  stockSlotPlan,
} from "./runtime-profiles.js";
import { LFM3_MODEL } from "./constants.js";
import type { ModelRecord } from "@workspace/model-catalog/localModels";

describe("local model runtime profiles", () => {
  it("selects the CPU executable and zero offload for explicit CPU configuration", () => {
    const model = record("Acme/Model-GGUF");
    model.config = { contextLength: 4096, gpuLayers: 0 };
    const cpu = {
      buildTag: "b1",
      backend: "cpu" as const,
      dir: "/cpu",
      serverBinPath: "/cpu/server",
      smokeTestedAt: 1,
    };
    const gpu = {
      ...cpu,
      backend: "cuda-12.4" as const,
      serverBinPath: "/gpu/server",
    };
    const recipe = effectiveModelRuntime(model, {
      pin: { buildTag: "b1", manifestSha256: "" },
      cpu,
      gpu,
      degradedReason: null,
    });
    expect(recipe).toEqual({
      bin: "/cpu/server",
      buildTag: "b1",
      backend: "cpu",
      contextLength: 4096,
      parallel: null,
      gpuLayers: 0,
    });
    expect(modelRuntimeArgs(recipe)).toEqual([
      "-c",
      "4096",
      "--n-gpu-layers",
      "0",
    ]);
    model.config.gpuLayers = 7;
    expect(
      effectiveModelRuntime(model, {
        pin: { buildTag: "b1", manifestSha256: "" },
        cpu,
        gpu,
        degradedReason: null,
      }),
    ).toMatchObject({ bin: "/gpu/server", gpuLayers: 7 });
    expect(
      effectiveModelRuntime(model, {
        pin: { buildTag: "b1", manifestSha256: "" },
        cpu,
        gpu: null,
        degradedReason: null,
      }),
    ).toMatchObject({ bin: "/cpu/server", gpuLayers: 0 });
  });

  it("rejects invalid configuration before an executable recipe is admitted", () => {
    for (const config of [
      { contextLength: 0, gpuLayers: 0 },
      { contextLength: null, gpuLayers: -2 },
      { contextLength: null, gpuLayers: 0.5 },
    ])
      expect(() => validatedRuntimeConfig(config)).toThrow();
  });

  it("uses the context window declared by the model", () => {
    expect(runtimeContextLengthFor(record("Acme/Model-GGUF"))).toBe(128_000);
  });

  it("serves a model of natlang's stock list in the slots natlang measured for it", () => {
    const q8 = stockRecord(LFM3_MODEL.quants.Q8_0.sha256, 1_846_238_496);
    // 4 GiB for model and KV: (4294967296 - 1846238496) / (32768 tokens * 23000 bytes) = 3 slots.
    expect(stockSlotPlan(q8)).toMatchObject({ slots: 3, contextPerSlot: 32_768, totalContext: 98_304 });
    expect(runtimeContextLengthFor(q8)).toBe(32_768);
    const cpu = { buildTag: "b1", backend: "cpu" as const, dir: "/cpu", serverBinPath: "/cpu/server", smokeTestedAt: 1 };
    const recipe = effectiveModelRuntime(q8, {
      pin: { buildTag: "b1", manifestSha256: "" },
      cpu,
      gpu: null,
      degradedReason: null,
    });
    expect(recipe).toMatchObject({ contextLength: 32_768, parallel: 3 });
    expect(modelRuntimeArgs(recipe)).toEqual(["-c", "98304", "-np", "3", "--swa-full", "--n-gpu-layers", "0"]);
    expect(stockSlotPlan(stockRecord(LFM3_MODEL.quants.Q4_K_M.sha256, 1_099_627_808))?.slots).toBe(4);
  });

  it("serves a stock model with the request natlang serves it with, and no other model with one", () => {
    const stock = stockRecord(LFM3_MODEL.quants.Q8_0.sha256, 1_846_238_496);
    // Greedy decoding with reasoning kept in the history: natlang's own stock settings, from its release record.
    expect(stockServingRequest(stock)).toEqual({
      temperature: 0,
      chat_template_kwargs: { preserve_thinking: true },
    });
    expect(stockServingRequest(record("Acme/Model-GGUF"))).toBeUndefined();
  });

  it("takes an explicit context length of a stock model as its per-slot window", () => {
    const configured = stockRecord(LFM3_MODEL.quants.Q8_0.sha256, 1_846_238_496);
    configured.config.contextLength = 16_384;
    expect(runtimeContextLengthFor(configured)).toBe(16_384);
    expect(stockSlotPlan(configured)).toMatchObject({ contextPerSlot: 16_384, slots: 6 });
  });

  it("leaves a model outside natlang's stock list as one slot of its declared window", () => {
    expect(stockSlotPlan(record("Acme/Model-GGUF"))).toBeNull();
  });

  it("keeps explicit model configuration above the family default", () => {
    const configured = record("Acme/Model-GGUF");
    configured.config.contextLength = 16_384;
    expect(runtimeContextLengthFor(configured)).toBe(16_384);
  });
});

function stockRecord(sha256: string, sizeBytes: number): ModelRecord {
  return { ...record("LiquidAI/LFM3-1.7B-GGUF"), sha256, sizeBytes, trainedContextLength: 262_144 };
}

function record(hfRepo: string): ModelRecord {
  const name = hfRepo.slice(hfRepo.lastIndexOf("/") + 1);
  return {
    slug: name.toLowerCase(),
    displayName: name,
    hfRepo,
    file: `/models/${name}-Q4_K_M.gguf`,
    sizeBytes: 1,
    quant: "Q4_K_M",
    paramCount: "1B",
    arch: "llama",
    trainedContextLength: 128_000,
    toolsCapable: true,
    sha256: "0".repeat(64),
    importedInPlace: false,
    config: { contextLength: null, gpuLayers: null },
    runtimeValidation: { status: "pending", error: null, validatedAt: null },
    addedAt: 1,
  };
}
