import { contextId } from "@workspace/runtime";
import { observeBuildProfile, profileBuild } from "@workspace/testkit";
import type {
  BuildPerformanceObservation,
  BuildPerformanceRequest,
} from "../performance/build/types.js";

type Assignment = {
  source: string;
  goal: string;
  initialBudgetBytes?: number;
};

export function bindBuildPerformance({
  source,
  goal,
  initialBudgetBytes,
}: Assignment) {
  if (!contextId || !source.trim() || !goal.trim())
    throw new Error("Assign one live context, unit and build question");
  if (
    initialBudgetBytes !== undefined &&
    (!Number.isSafeInteger(initialBudgetBytes) || initialBudgetBytes < 0)
  )
    throw new Error("Provide an initial payload budget in whole bytes");
  const ref = `ctx:${contextId}`;
  const operationId = crypto.randomUUID();
  const request: BuildPerformanceRequest = {
    operationId,
    goal,
    ...(initialBudgetBytes !== undefined ? { initialBudgetBytes } : {}),
  };

  async function observe(): Promise<BuildPerformanceObservation> {
    const profile = await profileBuild(source, { ref, verifyCache: true });
    if (profile.source !== source || profile.ref !== ref)
      throw new Error("The native profile belongs to another unit or context");
    return observeBuildProfile(profile);
  }

  let receipt: Promise<BuildPerformanceObservation> | undefined;
  return {
    request,
    services: {
      buildPerformance: {
        async observe(id: string): Promise<BuildPerformanceObservation> {
          if (id !== operationId)
            throw new Error("Profile only the caller's assigned unit");
          return structuredClone(await (receipt ??= observe()));
        },
      },
    },
  };
}
