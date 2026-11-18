import type {
  SystemPerformanceComparison,
  SystemPerformanceInput,
} from "../../types.js";

function median(values: number[]): number {
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2
    ? ordered[middle]!
    : (ordered[middle - 1]! + ordered[middle]!) / 2;
}

export default function compare(
  input: SystemPerformanceInput,
): SystemPerformanceComparison {
  const { baseline, candidate, regressionBudgetPercent } = input;
  if (
    baseline.boundary !== candidate.boundary ||
    baseline.cache !== candidate.cache ||
    baseline.workload !== candidate.workload
  ) {
    return { verdict: "incomparable", changePercent: null };
  }
  if (
    [baseline, candidate].some(
      ({ elapsedMs }) =>
        elapsedMs.length < 3 ||
        elapsedMs.some((value) => !Number.isFinite(value) || value <= 0),
    )
  ) {
    return { verdict: "insufficient-samples", changePercent: null };
  }
  const prior = median(baseline.elapsedMs);
  const current = median(candidate.elapsedMs);
  return {
    verdict:
      (current - prior) * 100 > prior * regressionBudgetPercent
        ? "regression"
        : "within-budget",
    changePercent: ((current - prior) / prior) * 100,
  };
}
