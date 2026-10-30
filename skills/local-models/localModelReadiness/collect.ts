/** Read the model list, judge each failure, and assemble the report. Only naming a failure is natural language. */
import { localModels } from "natlang:services";
import failureKind from "./failureKind.nl";
import assemble from "./assemble.js";
import type { ModelRow, Readiness } from "../types.js";

export default async function collect(): Promise<Readiness> {
  const rows: ModelRow[] = await localModels.listModels();
  const failures = await Promise.all(
    rows.map((row) =>
      row.state === "error" && row.errorMessage ? failureKind(row.errorMessage) : undefined
    )
  );
  return assemble(rows, failures);
}
