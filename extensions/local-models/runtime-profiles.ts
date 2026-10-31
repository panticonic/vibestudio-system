import {
  DEFAULT_KV_BUDGET_CAP_BYTES,
  STOCK_MODELS,
  planServerSlots,
  type SlotPlan,
} from "./vendor/llama/natlang-llama.js";
import type {
  EngineState,
  ModelRecord,
  ModelRuntimeConfig,
  ModelRuntimeValidationRecipe,
} from "@workspace/model-catalog/localModels";

export function validatedRuntimeConfig(
  config: ModelRuntimeConfig,
): ModelRuntimeConfig {
  if (
    config.contextLength !== null &&
    (!Number.isSafeInteger(config.contextLength) || config.contextLength <= 0)
  )
    throw new Error("Model contextLength must be null or a positive integer");
  if (
    config.gpuLayers !== null &&
    (!Number.isSafeInteger(config.gpuLayers) || config.gpuLayers < -1)
  )
    throw new Error("Model gpuLayers must be null or an integer >= -1");
  return { contextLength: config.contextLength, gpuLayers: config.gpuLayers };
}

export function sameRuntimeConfig(
  a: ModelRuntimeConfig,
  b: ModelRuntimeConfig,
): boolean {
  return a.contextLength === b.contextLength && a.gpuLayers === b.gpuLayers;
}

/** The same admitted model recipe drives validation and both serving roles. */
export function effectiveModelRuntime(
  record: ModelRecord,
  engines: EngineState | null,
) {
  const config = validatedRuntimeConfig(record.config);
  const engine =
    config.gpuLayers === 0 ? engines?.cpu : (engines?.gpu ?? engines?.cpu);
  if (!engine) throw new Error("llama.cpp engine is not installed");
  return {
    bin: engine.serverBinPath,
    buildTag: engine.buildTag,
    backend: engine.backend,
    contextLength: runtimeContextLengthFor(record),
    parallel: stockSlotPlan(record)?.slots ?? null,
    gpuLayers: engine.backend === "cpu" ? 0 : config.gpuLayers,
  };
}

export type ModelRuntimeRecipe = ReturnType<typeof effectiveModelRuntime>;

export function modelRuntimeArgs(recipe: ModelRuntimeRecipe): string[] {
  return [
    "-c",
    String(totalContextLength(recipe)),
    ...(recipe.parallel === null ? [] : ["-np", String(recipe.parallel), "--swa-full"]),
    ...(recipe.gpuLayers === null
      ? []
      : ["--n-gpu-layers", String(recipe.gpuLayers)]),
  ];
}

/** llama-server's `-c` is shared by its slots: each of `parallel` slots serves `contextLength` tokens. */
export function totalContextLength(recipe: {
  contextLength: number;
  parallel: number | null;
}): number {
  return recipe.contextLength * (recipe.parallel ?? 1);
}

/**
 * The slots natlang serves a model of its stock list with: its measured per-slot context and KV cost, sized to one
 * fixed memory budget for model and KV together (the cap natlang puts on a default server). The budget is explicit,
 * not the free memory at launch, so the recipe — which decides restarts and validation — is a function of the record.
 * `kvBytesPerToken` is the release's own figure for the cache as it is served. These models are served with
 * `--swa-full`: without it llama.cpp cannot resume from a restored warm prompt opening (nor reuse any earlier prompt) on
 * their sliding-window layers and evaluates the whole prompt again.
 */
export function stockSlotPlan(record: ModelRecord): SlotPlan | null {
  const release = STOCK_MODELS.find((stock) => stock.sha256 === record.sha256);
  if (!release) return null;
  return planServerSlots({
    local: {
      memoryBudgetMiB: DEFAULT_KV_BUDGET_CAP_BYTES / 2 ** 20,
      ...(record.config.contextLength === null
        ? {}
        : { contextTokens: record.config.contextLength }),
    },
    modelBytes: record.sizeBytes,
    defaultContextTokens: release.contextTokens,
    defaultKvBytesPerToken: release.kvBytesPerToken,
  });
}

/**
 * The request fields natlang serves a stock model with (greedy decoding, template arguments such as
 * `preserve_thinking`), from the same release record its own server reads. Another model has none: its sampler
 * defaults stay in its GGUF. The model catalog carries them as the model's sampling parameters, so every request
 * to the model, from the gateway or an agent, is made with the settings its suites were measured with.
 */
export function stockServingRequest(
  record: ModelRecord,
): Record<string, unknown> | undefined {
  const request = STOCK_MODELS.find(
    (stock) => stock.sha256 === record.sha256,
  )?.request;
  return request ? (JSON.parse(JSON.stringify(request)) as Record<string, unknown>) : undefined;
}

/**
 * Runtime context is model-owned unless the user explicitly overrides it.
 * Chat templates and sampler defaults remain in GGUF metadata and are applied
 * by llama.cpp; this layer must not silently replace either per model family.
 * A model with a natlang slot plan serves each request in one slot, so its
 * window is the slot's.
 */
export function runtimeContextLengthFor(record: ModelRecord): number {
  const plan = stockSlotPlan(record);
  if (plan) return plan.contextPerSlot;
  return record.config.contextLength ?? record.trainedContextLength;
}

export function observedRuntimeRecipe(
  recipe: ModelRuntimeRecipe,
): ModelRuntimeValidationRecipe {
  return {
    buildTag: recipe.buildTag,
    backend: recipe.backend,
    contextLength: recipe.contextLength,
    gpuLayers: recipe.gpuLayers,
  };
}

export function sameRuntimeRecipe(
  a: ModelRuntimeValidationRecipe,
  b: ModelRuntimeValidationRecipe,
): boolean {
  return (
    a.buildTag === b.buildTag &&
    a.backend === b.backend &&
    a.contextLength === b.contextLength &&
    a.gpuLayers === b.gpuLayers
  );
}
