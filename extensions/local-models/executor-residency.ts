/**
 * Whether natlang's executor model (LFM3) can stay loaded beside the main model. The router serves both: the executor
 * runs every natlang call, so unloading it for each call of a local agent model would reload it each time. When the
 * two cannot be resident together the executor is not served at all (its entry reports why, and the executor role
 * resolves to the hosted model) instead of the two evicting each other.
 */
import type {
  EngineState,
  HardwareProfile,
  ModelRecord,
} from "@workspace/model-catalog/localModels";
import { effectiveModelRuntime, stockSlotPlan } from "./runtime-profiles.js";
import { estimateFit } from "./library.js";

export type ExecutorResidency = { resident: true } | { resident: false; reason: string };

/** What the executor holds once loaded: its weights and the KV of the slots natlang plans for it. */
export function executorFootprintBytes(executor: ModelRecord): number {
  const plan = stockSlotPlan(executor);
  return plan
    ? plan.modelBytes + plan.totalContext * plan.kvBytesPerToken
    : executor.sizeBytes;
}

export function executorResidency(input: {
  /** The main (agent) model that is, or is about to be, loaded; null when there is none. */
  main: ModelRecord | null;
  executor: ModelRecord;
  hardware: HardwareProfile | null;
  engines: EngineState | null;
}): ExecutorResidency {
  const { main, executor, hardware, engines } = input;
  if (!main || main.slug === executor.slug || !hardware) return { resident: true };

  // One router process serves both models, so both run on one engine build.
  let mainBin: string | null = null;
  let executorBin: string | null = null;
  try {
    mainBin = effectiveModelRuntime(main, engines).bin;
    executorBin = effectiveModelRuntime(executor, engines).bin;
  } catch {
    // No installed engine: there is nothing to compare, and nothing can be loaded either.
  }
  if (mainBin !== null && executorBin !== null && mainBin !== executorBin) {
    return {
      resident: false,
      reason: `${main.displayName} is configured for a different engine than the executor model, and one router serves both.`,
    };
  }

  // The same weights-against-memory rule that places every model, applied to both together.
  const executorBytes = executorFootprintBytes(executor);
  const together = estimateFit(
    {
      sizeBytes: main.sizeBytes + executorBytes,
      trainedContextLength: main.trainedContextLength,
    },
    hardware,
  );
  if (together.fit === "too-big") {
    const mb = (bytes: number) => Math.ceil(bytes / (1024 * 1024));
    return {
      resident: false,
      reason: `${main.displayName} (${mb(main.sizeBytes)} MiB) and the executor model (${mb(executorBytes)} MiB with its slots) do not fit in memory together.`,
    };
  }
  return { resident: true };
}
