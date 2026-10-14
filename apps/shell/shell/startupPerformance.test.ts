import { afterEach, describe, expect, it } from "vitest";
import { measureShellPhase } from "./startupPerformance";

afterEach(() => {
  for (const entry of performance.getEntriesByType("measure")) {
    if (entry.name.startsWith("shell:")) performance.clearMeasures(entry.name);
  }
  performance.clearMeasures("unrelated-profile");
});

describe("shell presentation phase attribution", () => {
  it("records the owning promise completion and preserves its original result or failure", async () => {
    let release!: (value: object) => void;
    const value = {};
    const operation = measureShellPhase(
      "test-phase",
      "workspace",
      () =>
        new Promise<object>((resolve) => {
          release = resolve;
        })
    );
    expect(performance.getEntriesByName("shell:test-phase:workspace")).toHaveLength(0);
    release(value);
    expect(await operation).toBe(value);
    expect(performance.getEntriesByName("shell:test-phase:workspace")[0]).toMatchObject({
      detail: { phase: "test-phase", scope: "workspace", outcome: "complete" },
    });
    const failure = new Error("original failure");
    await expect(
      measureShellPhase("test-phase", "workspace", () => {
        throw failure;
      })
    ).rejects.toBe(failure);
    expect(performance.getEntriesByName("shell:test-phase:workspace")).toHaveLength(1);
    expect(performance.getEntriesByName("shell:test-phase:workspace")[0]).toMatchObject({
      detail: { phase: "test-phase", scope: "workspace", outcome: "failed" },
    });
  });

  it("bounds retained workspace phases without removing unrelated profiling data", async () => {
    performance.measure("unrelated-profile", { start: performance.now() });
    for (let index = 0; index < 100; index += 1) {
      await measureShellPhase("retention", `workspace-${index}`, () => index);
    }
    expect(
      performance.getEntriesByType("measure").filter((entry) => entry.name.startsWith("shell:"))
    ).toHaveLength(64);
    expect(performance.getEntriesByName("shell:retention:workspace-0")).toHaveLength(0);
    expect(performance.getEntriesByName("shell:retention:workspace-99")).toHaveLength(1);
    expect(performance.getEntriesByName("unrelated-profile")).toHaveLength(1);
  });
});
