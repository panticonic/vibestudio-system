# Remote access: what is natural language and what is crisp

The first port covered classifying which layer of a remote setup failed (steps 1-3 of "Diagnosis and repair").

| Part | Form | Why |
| --- | --- | --- |
| Which layer failed, from `remote doctor` output, `remote status`, or endpoint registration logs | own function, `remoteLayer`, `readout: decision` | Nine finite layers. The doctor prints `✓`/`✗`/`○` lines with free-text messages, and the hub-routing and child-endpoint cases arrive as prose from status and logs, so a fixed parse of `doctor` would cover only four of the nine. Scored by exact match. |
| The next check for each layer | `SKILL.md` table | One row per layer: a command or a log. Crisp enough to be a table; the agent runs the command. |
| Running a standalone `remote doctor` or `rotate-endpoint` | agent and CLI | These are separate operator actions. Endpoint rotation can require every device to pair again. |
| Running deploy and pair from an explicit assignment | Natlang workflows described below | The host binds the target and profile, and the workflows use live receipts to decide which steps to take. |
| Never build a reach or link by hand; relay fallback is not a downgrade | stays in the skill text | Rules, not procedure. |

The cases are captured from `scripts/cli/remote-doctor.mjs`'s own messages where the doctor produces them. Routing and child-endpoint cases are authored from the skill's description of those layers; no captured log of those two failures exists in the repository.

## Measurement

Executor: LFM3-1.7B Q8_0 on natlang's llama.cpp fork (b12067), CPU, decision readout where the function declares one. Gates for porting: mean quality of at least 0.85 on the validation split and on the locked test split of `suite.ts` / `cases.jsonl` (remoteLayer 9/8/8).

Status: **not measured to a gate; stays agent-executed. The layer-to-next-check table in `SKILL.md` is the crisp half and applies either way.**

Why the baseline is incomplete: on the host this was built on (load average 17-30 from other agents' model servers) a decision call costs three cold prefills of a ~3.9k-token opening, about 11-16 minutes, because the scorer sends each candidate reply as its own request and the slots do not share the prefix; the whole split set would take about a day. Two defects in the evaluation path also have to be repaired before `pnpm natlang:eval` can produce these numbers: the evaluation worker (`ts-host/src/evaluation/worker-entry.ts`) hands the runtime a bare turn function, and the CLI/driver in `scripts/natlang-eval.mjs` and `cli/adaptation.ts` pass `executor.turn` only, so a `readout: decision` call reports `decision_readout: unavailable ("model driver cannot score replies")` and runs as a full tool loop. The figures here come from an in-process scratch harness that keeps the readout and uses the suite's own cases, fixture and scorer.

Reference model (the agent's own): not measured; no agent-class model is available in the harness. The case labels were written by the agent-class model from the skill text.

## Open an assigned remote workspace

The caller pins a device profile, the server identity, the workspace identity,
and a trusted invitation when pairing is part of the assignment. The Natlang
workflow assesses the observed profile, decides whether it should pair or use
existing credentials, refreshes the selected route through hub control, and
checks the independent child connection. Separate leaves own each service call.
The host retains the invitation and credentials, rejects stale receipts, and
persists the final assigned selection after the child identifies itself. A device already
paired to another server remains outside the workflow's assignment.

## Deploy or update an assigned server

The host seals the deployment target, artifact, relays, and operation. The
workflow observes the managed service before choosing whether an install or
update is appropriate. It uses separate leaves for the managed installer and
the subsequent readiness verification. The verifier checks the protected ready
record against hub and child health, and requires a new hub boot after a launch.
An update also preserves the server and workspace identifiers. The existing CLI
owns systemd, SSH, package installation, and Iroh doctor operations. The
deployment program receives bounded public state and never needs a pairing link.

## Commission an assigned remote workspace

| Part | Form | Why |
| --- | --- | --- |
| Choose whether deployment evidence permits opening a device route | `commissionRemoteWorkspace` lambda | The operation may install a server, update it, or reuse an already healthy deployment. Their reports determine the next step. |
| Resolve the deployment receipt to a trusted access assignment | Scoped `bindVerifiedWorkspace` leaf and host adapter | The host checks that the hub and child still match the receipt and binds the caller's device profile. |
| Pair or resume the profile and verify its route | Existing `openRemoteWorkspace` workflow | The same policy applies to fresh and resumed commissioning. Its own leaves verify exact workspace identity. |

## Review an observed workspace route

A caller that already obtained a gateway route can review the identity of
the workspace it actually reached. This reuses the remote-layer diagnosis
without issuing a new pairing, refreshing a reach, or changing a profile.

| Responsibility | Implementation |
| --- | --- |
| Read the opened gateway | `readGatewayIdentity` calls a scoped read-only port. The receipt carries server, boot and workspace identity. |
| Compare the authenticated identity with the assignment | `compareGatewayIdentity` uses exact equality. A server mismatch takes precedence over a workspace mismatch. |
| Interpret the observed route mismatch | `reviewRemoteRoute` calls the existing `remoteLayer` decision using a diagnostic statement derived from the receipt. |
| Choose the supported next step | `routeHandoff` uses the exact layer and identity verdict. The caller remains responsible for control and transport actions. |
## CLI continuation after route verification

`planCliContinuation` reads the authenticated gateway observed by the route
review and the assigned CLI invocation. `selectContextSource` applies CLI
selector precedence. `assessCliContext` checks the selected identity against
the credential. `chooseCliAction` determines whether to continue with the
paired device, ask the parent agent, or repair the selected scope. The caller
supplies redacted coordinates and independently verifies the recommendation.

## Commissioning task bank

The shared workflow uses the same deployment, handoff, and device-access
lambdas for fresh installs, resumed profiles, and holds. The scoped corpus
assigns each attempt a single operation and device profile. The adapter admits
each effect only after the preceding observation and requires the receipt
from that attempt. The independent oracle checks the exact receipt order,
identity, and whether the workflow stopped before a disallowed effect. The
host smoke uses a disposable VibeStudio hub and profile to check the native
binding, including actual pairing and verification through the child gateway.
