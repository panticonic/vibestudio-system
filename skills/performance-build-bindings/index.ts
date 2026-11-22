import { contextId } from "@workspace/runtime";
import { profileBuild } from "@workspace/testkit";
import type {
  BuildPerformanceObservation,
  BuildPerformanceRequest,
} from "@workspace-skills/performance/build-types";

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
    const error = profile.report.diagnostics.find(({ severity }) => severity === "error");
    return {
      source,
      stateHash: profile.report.stateHash,
      status: profile.report.status,
      first: {
        elapsedMs: profile.firstRun.elapsedMs,
        cacheState: profile.firstRun.cacheState,
        phases: profile.firstRun.phases ?? null,
      },
      repeat: profile.verifiedCacheRun ?? null,
      targets: profile.targets.map((target) => ({
        target: target.target,
        buildKey: target.buildKey,
        artifactBytes: target.artifactBytes,
        executableSourceBytes: target.executableSourceBytes,
        payload: target.bundleReport
          ? {
              initialBytes: target.bundleReport.initial.bytes,
              lazyBytes: target.bundleReport.lazy.bytes,
              totalBytes: target.bundleReport.total.bytes,
              largestInitialInputs: target.bundleReport.largestInitialInputs.slice(0, 10),
            }
          : null,
      })),
      firstError: error
        ? { file: error.file, message: error.message.slice(0, 600) }
        : null,
    };
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
