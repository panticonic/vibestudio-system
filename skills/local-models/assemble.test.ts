import { describe, expect, it } from "vitest";
import assemble from "./localModelReadiness/assemble.js";
import type { ModelRow } from "./types.js";

const row = (
  slug: string,
  state: ModelRow["state"],
  overrides: Partial<ModelRow> = {}
): ModelRow => ({
  slug,
  displayName: slug,
  state,
  fit: { fit: "cpu-only", estTokensPerSec: null },
  download: null,
  errorMessage: null,
  ...overrides,
});

describe("assemble", () => {
  it("prefers the 27B model, then LFM3, then LFM2.5, among usable models", () => {
    const rows = [
      row("lfm2.5-2.6b", "ready"),
      row("lfm3-1.7b", "startable"),
      row("qwen3.8-27b", "downloading"),
    ];
    expect(assemble(rows, []).preferred).toBe("local:lfm3-1.7b");
    expect(assemble([row("qwen3.8-27b", "startable"), ...rows.slice(0, 2)], []).preferred).toBe(
      "local:qwen3.8-27b"
    );
    expect(assemble([row("lfm3-1.7b", "starting")], []).preferred).toBeNull();
  });

  it("says natlang uses the billed hosted model when the executor is not usable", () => {
    const report = assemble(
      [row("lfm3-1.7b", "downloading", { download: { progress: 0.4, phase: "active" } })],
      []
    );
    expect(report.executor).toMatchObject({
      ref: "local:lfm3-1.7b",
      usable: false,
      state: "downloading",
    });
    expect(report.models[0]?.detail).toBe("downloading, 40% (active)");
    expect(report.advice[0]).toContain("billed");
  });

  it("reports an absent executor and an empty list", () => {
    const report = assemble([], []);
    expect(report.executor).toMatchObject({ usable: false, state: "absent" });
    expect(report.preferred).toBeNull();
  });

  it("carries the failure kind and its advice", () => {
    const report = assemble(
      [row("lfm3-1.7b", "error", { errorMessage: "ENOSPC: no space left on device" })],
      ["storage"]
    );
    expect(report.models[0]).toMatchObject({ usable: false, failure: "storage" });
    expect(report.advice.some((line) => line.startsWith("local:lfm3-1.7b: The disk refused"))).toBe(
      true
    );
  });
});
