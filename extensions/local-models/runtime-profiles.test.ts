import { describe, expect, it } from "vitest";
import {
  effectiveModelRuntime,
  modelRuntimeArgs,
  validatedRuntimeConfig,
  runtimeContextLengthFor,
} from "./runtime-profiles.js";
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
      pin: { buildTag: "b1", checksums: {} },
      cpu,
      gpu,
      degradedReason: null,
    });
    expect(recipe).toEqual({
      bin: "/cpu/server",
      buildTag: "b1",
      backend: "cpu",
      contextLength: 4096,
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
        pin: { buildTag: "b1", checksums: {} },
        cpu,
        gpu,
        degradedReason: null,
      }),
    ).toMatchObject({ bin: "/gpu/server", gpuLayers: 7 });
    expect(
      effectiveModelRuntime(model, {
        pin: { buildTag: "b1", checksums: {} },
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

  it("keeps explicit model configuration above the family default", () => {
    const configured = record("Acme/Model-GGUF");
    configured.config.contextLength = 16_384;
    expect(runtimeContextLengthFor(configured)).toBe(16_384);
  });
});

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
