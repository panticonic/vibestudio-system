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
    gpuLayers: engine.backend === "cpu" ? 0 : config.gpuLayers,
  };
}

export type ModelRuntimeRecipe = ReturnType<typeof effectiveModelRuntime>;

export function modelRuntimeArgs(recipe: ModelRuntimeRecipe): string[] {
  return [
    "-c",
    String(recipe.contextLength),
    ...(recipe.gpuLayers === null
      ? []
      : ["--n-gpu-layers", String(recipe.gpuLayers)]),
  ];
}

/**
 * Runtime context is model-owned unless the user explicitly overrides it.
 * Chat templates and sampler defaults remain in GGUF metadata and are applied
 * by llama.cpp; this layer must not silently replace either per model family.
 */
export function runtimeContextLengthFor(record: ModelRecord): number {
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
