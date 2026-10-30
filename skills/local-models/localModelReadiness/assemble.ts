/** The readiness rules: which states are usable, which model natlang runs on, which to prefer, what to advise. */
import type { FailureKind, ModelReadiness, ModelRow, Readiness } from "../types.js";

const EXECUTOR = "local:lfm3-1.7b";
/** Agent-task preference, best first. */
const PREFERENCE = ["local:qwen3.8-27b", "local:lfm3-1.7b", "local:lfm2.5-2.6b"];

const FAILURE_ADVICE: Record<FailureKind, string> = {
  download:
    "The download failed; report the error and retry only if the user asks to install again.",
  storage: "The disk refused; ask the user to free space or fix permissions, then retry.",
  memory: "The machine ran out of memory; suggest a smaller model.",
  engine: "The model server failed; check a bounded server-log tail for the cause.",
  unknown: "Report the error text as given.",
};

function describe(row: ModelRow, failure?: FailureKind): string {
  switch (row.state) {
    case "ready":
      return "running";
    case "startable":
      return `downloaded and healthy; starts on demand (${row.fit.fit})`;
    case "not-installed":
      return row.fit.fit === "too-big" ? "offered but too big for this machine" : "not downloaded";
    case "starting":
      return "starting";
    case "downloading":
      return `downloading${row.download ? `, ${Math.round(row.download.progress * 100)}% (${row.download.phase})` : ""}`;
    case "error":
      return `failed${failure ? ` (${failure})` : ""}: ${row.errorMessage ?? "no message"}`;
  }
}

export default function assemble(
  rows: ModelRow[],
  failures: (FailureKind | undefined)[]
): Readiness {
  const models: ModelReadiness[] = rows.map((row, index) => ({
    ref: `local:${row.slug}`,
    state: row.state,
    usable: row.state === "ready" || row.state === "startable",
    detail: describe(row, failures[index]),
    ...(failures[index] ? { failure: failures[index] } : {}),
  }));
  const executor = models.find((model) => model.ref === EXECUTOR);
  const preferred =
    PREFERENCE.find((ref) => models.some((model) => model.ref === ref && model.usable)) ?? null;
  const advice: string[] = [];
  if (!executor)
    advice.push(
      "local:lfm3-1.7b is not offered here; natlang programs use the hosted low-tier model, which is billed."
    );
  else if (!executor.usable)
    advice.push(
      `local:lfm3-1.7b is ${executor.state}: natlang programs use the hosted low-tier model, which is billed, until it is usable.`
    );
  for (const model of models) {
    if (model.failure) advice.push(`${model.ref}: ${FAILURE_ADVICE[model.failure]}`);
    else if (model.state === "not-installed" && model.ref === EXECUTOR)
      advice.push(
        "Offer to install local:lfm3-1.7b if the user wants natlang programs to run locally."
      );
  }
  return {
    models,
    executor: executor
      ? {
          ref: executor.ref,
          usable: executor.usable,
          state: executor.state,
          detail: executor.detail,
        }
      : { ref: EXECUTOR, usable: false, state: "absent", detail: "not offered on this machine" },
    preferred,
    advice,
  };
}
