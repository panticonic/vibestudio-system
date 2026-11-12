# Decomposition: local model readiness

The function is `localModelReadiness(): Readiness` (`localModelReadiness.nl`). The old skill said: read `listModels`,
treat `startable` and `ready` as usable, report `downloading`, `starting` and `error` as they are, prefer
`local:qwen3.8-27b`, and use the small model otherwise.

| Part | Decision | Why |
|---|---|---|
| Read the catalog (`listModels` through `extensions.invoke`, decoded with the shared method descriptor) | crisp, `localModelReadiness/collect.ts` | The outside world. The `localModels` natlang service exposes only `listModels`: no install, start or stop, and no `getHardwareProfile`. |
| `usable` = state `ready` or `startable` | crisp, `assemble.ts` | A rule of the skill, exact over an enum. |
| The natlang executor (`local:lfm3-1.7b`) and the agent-task preference (qwen3.8-27b, then lfm3-1.7b, then lfm2.5-2.6b) | crisp, `assemble.ts` | Data from the skill and the plan (D4). When the executor is not usable natlang uses the hosted low-tier model, which is billed; the report says so. |
| What kind of failure an `errorMessage` describes (download, storage, memory, engine, unknown) | own function `localModelReadiness/failureKind.nl`, `readout: decision` | The only free text in the catalog. Each kind has a different remedy, and the messages come from many layers (HTTP, checksum, `ENOSPC`, allocator, smoke test). A literal union, so one scoring pass. |
| The advice line for each kind | crisp table in `assemble.ts` | The remedy is fixed per kind. |
| Installing a model | stays with the agent | Installing needs the user's request. The report only offers it. |

Most of this function is deliberately crisp. A model reading `state` would add nothing and could only make it worse.

## Suite

`suite.ts` + `cases.jsonl`: 15 cases (7 train, 4 validation, 4 test). The rows are recorded-shaped `listModels` answers
built by the extension (`system/extensions/local-models/index.ts`); the error texts are modelled on the extension's own
messages (`Checksum mismatch for`, `Failed to download`, `llama-server smoke test failed`) and on common disk and
allocator errors. Quality is the fraction of the report's checks that are right (executor usable and state, preferred
model, each failure kind); the gate is `exact`.

## Measurement

Executor: LFM3-1.7B Q8_0 on natlang's llama.cpp fork (b12068), CPU, decision readout scored (`sessionDriver`), run in-process
with the suite's own cases, fixture and scorer. Gate: mean quality of at least 0.85 on validation and on the locked test
split; `exact` per case.

| Split | Mean quality | Exact cases | Gate |
|---|---|---|---|
| validation (4) | 1.000 | 4 of 4 | met (also through `pnpm natlang:eval`) |
| test (4) | 0.938 (also through `pnpm natlang:eval`) | 3 of 4 (`local-models bootstrap failed`, a message with no detail, read as `engine`) | met |

About 7-10 s per case (one decision per failed model; a machine with no failed model makes no model call at all).

Reference model (the agent's own): not measured; no agent-class model is available in the harness. Labels were written by
the author from the extension's own error messages.
