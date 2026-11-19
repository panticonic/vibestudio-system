import { beforeEach, expect, it, vi } from "vitest";
import { bindBuildPerformance } from "./index.js";

const { profileBuild } = vi.hoisted(() => ({ profileBuild: vi.fn() }));
vi.mock("@workspace/testkit", () => ({ profileBuild }));
vi.mock("@workspace/runtime", () => ({ contextId: "assigned-context" }));

const source = "panels/review";
const ref = "ctx:assigned-context";
const report = {
  source,
  ref,
  report: { stateHash: "assigned-state", status: "ok", diagnostics: [] },
  firstRun: {
    elapsedMs: 17,
    cacheState: "built-during-profile",
    phases: { bundlingMs: 13, validationMs: 3, otherMs: 1 },
  },
  verifiedCacheRun: { elapsedMs: 2, sameBuildKeys: true },
  targets: [
    {
      target: "runtime",
      buildKey: "runtime-key",
      artifactBytes: 800,
      executableSourceBytes: 100,
      bundleReport: {
        initial: { bytes: 220 },
        lazy: { bytes: 180 },
        total: { bytes: 400 },
        largestInitialInputs: [{ source: "panel.ts", bytes: 170 }],
      },
    },
  ],
};

beforeEach(() => {
  profileBuild.mockReset();
  profileBuild.mockResolvedValue(report);
});

it("uses one native profile and keeps the byte measures and build identity separate", async () => {
  const { request, services } = bindBuildPerformance({
    source,
    goal: "Check the initial payload",
    initialBudgetBytes: 0,
  });
  await expect(services.buildPerformance.observe("another-operation")).rejects.toThrow(
    "assigned",
  );
  expect(profileBuild).not.toHaveBeenCalled();
  const observe = () => services.buildPerformance.observe(request.operationId);
  const [first, second] = await Promise.all([observe(), observe()]);
  expect(profileBuild).toHaveBeenCalledExactlyOnceWith(source, { ref, verifyCache: true });
  expect(request.initialBudgetBytes).toBe(0);
  expect(first).toEqual(second);
  expect(first).not.toBe(second);
  expect(first).toEqual({
    source,
    stateHash: "assigned-state",
    status: "ok",
    first: {
      elapsedMs: 17,
      cacheState: "built-during-profile",
      phases: { bundlingMs: 13, validationMs: 3, otherMs: 1 },
    },
    repeat: { elapsedMs: 2, sameBuildKeys: true },
    targets: [
      {
        target: "runtime",
        buildKey: "runtime-key",
        artifactBytes: 800,
        executableSourceBytes: 100,
        payload: {
          initialBytes: 220,
          lazyBytes: 180,
          totalBytes: 400,
          largestInitialInputs: [{ source: "panel.ts", bytes: 170 }],
        },
      },
    ],
    firstError: null,
  });
});

it("rejects a native profile from a different context", async () => {
  profileBuild.mockResolvedValue({ ...report, ref: "ctx:another-context" });
  const { request, services } = bindBuildPerformance({ source, goal: "Check build timing" });
  await expect(services.buildPerformance.observe(request.operationId)).rejects.toThrow(
    "another unit or context",
  );
});
