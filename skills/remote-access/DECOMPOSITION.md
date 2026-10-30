# Remote access: what is natural language and what is crisp

Ported sub-procedure: classifying which layer of a remote setup failed (steps 1-3 of "Diagnosis and repair").

| Part | Form | Why |
| --- | --- | --- |
| Which layer failed, from `remote doctor` output, `remote status`, or endpoint registration logs | own function, `remoteLayer`, `readout: decision` | Nine finite layers. The doctor prints `✓`/`✗`/`○` lines with free-text messages, and the hub-routing and child-endpoint cases arrive as prose from status and logs, so a fixed parse of `doctor` would cover only four of the nine. Scored by exact match. |
| The next check for each layer | `SKILL.md` table | One row per layer: a command or a log. Crisp enough to be a table; the agent runs the command. |
| Running `remote doctor`, `rotate-endpoint`, deploy, pair | stays with the agent | Effects on a server and on identities (`rotate-endpoint` re-pairs every device). |
| Never build a reach or link by hand; relay fallback is not a downgrade | stays in the skill text | Rules, not procedure. |

The cases are captured from `scripts/cli/remote-doctor.mjs`'s own messages where the doctor produces them. Routing and child-endpoint cases are authored from the skill's description of those layers; no captured log of those two failures exists in the repository.

## Measurement

Executor: LFM3-1.7B Q8_0 on natlang's llama.cpp fork (b12067), CPU, decision readout where the function declares one. Gates for porting: mean quality of at least 0.85 on the validation split and on the locked test split of `suite.ts` / `cases.jsonl` (remoteLayer 9/8/8).

Status: **not measured to a gate; stays agent-executed. The layer-to-next-check table in `SKILL.md` is the crisp half and applies either way.**

Why the baseline is incomplete: on the host this was built on (load average 17-30 from other agents' model servers) a decision call costs three cold prefills of a ~3.9k-token opening, about 11-16 minutes, because the scorer sends each candidate reply as its own request and the slots do not share the prefix; the whole split set would take about a day. Two defects in the evaluation path also have to be repaired before `pnpm natlang:eval` can produce these numbers: the evaluation worker (`ts-host/src/evaluation/worker-entry.ts`) hands the runtime a bare turn function, and the CLI/driver in `scripts/natlang-eval.mjs` and `cli/adaptation.ts` pass `executor.turn` only, so a `readout: decision` call reports `decision_readout: unavailable ("model driver cannot score replies")` and runs as a full tool loop. The figures here come from an in-process scratch harness that keeps the readout and uses the suite's own cases, fixture and scorer.

Reference model (the agent's own): not measured; no agent-class model is available in the harness. The case labels were written by the agent-class model from the skill text.
