# Prepare a local model for an agent task

The local-models skill defines the capability boundary. Its existing readiness program reports the whole inventory and classifies failure messages. This workflow prepares one selected model and returns a typed handoff for the ordinary agent runtime.

Inventory before implementation:

- `skills/local-models/localModelReadiness/collect.ts` and `assemble.ts` consume the read-only inventory and apply the ready/startable distinction. Keep the existing whole-inventory report with its public executor selection behavior.
- `extensions/local-models/index.ts` implements `listModels` and `installModel`, including current hardware offers, idempotent validation, and waiting for transfer and runtime validation. The adapter calls these existing operations and leaves transfer and lifecycle to their owner.
- `extensions/local-models/package.json` marks listModels website-eligible and installModel website-closed. The caller grants an exact installation ref separately from the model's instructions, and the adapter calls the same extension under the caller's existing authority.
- Base `packages/model-catalog/src/localModels.ts` owns the list wire schema and DownloadJob interface. Base Natlang services currently expose the unprivileged list service. The caller-bound task contract projects out paths and endpoint fields, and adds a separately scoped exact installation capability without changing the public discovery service.
- The ordinary agent runtime owns delegation, startup and endpoint credentials. Only the handoff's exact model ref, conversation mode and observed state leave this workflow for the caller.

| Stage | Responsibility |
| --- | --- |
| `prepareLocalModel` | Coordinate inspection, requested intent, installation once when eligible, and final observation. Choose when to pursue the readiness handoff. |
| `inspectSelected` and `interpretState` | Read the exact selected row and explain whether the user can proceed or must wait. Explain free-text catalogue failures in the context of the requested task. |
| `decideInstallation` | Distinguish inspection from an explicit prepare/run request, and propose an installation only when needed. |
| `applyInstallation` | Invoke the isolated capability once. Preserve the returned job or validation receipt. |
| `readOutcome` and `resolveOutcome` | Re-observe the selected model, distinguish disappearance, ongoing transfer, rejection, and usable readiness. Never treat the receipt alone as successful readiness. |
| `planDelegation` | Choose fresh or fork based on the request's actual dependence on prior conversation and verify the task's tool/context needs. |
| Caller adapter | Decode the canonical response, expose only safe fields, reject mismatched authorization, recheck inventory before the effect, and never repeat an attempted install within one assignment. |
| Fixture oracle | Compare the typed result against independent case expectations and require an exact ordered, caller-recorded interaction journal. |

Execution and verification use owner-scoped fixture ports. They do not start models or download artifacts.

## Compare candidates for one workspace task

The compare operation decides whether one of the caller's ordered alternatives can take an existing
workspace task. `compareCandidates` delegates each exact ref to `reviewCandidate`, which calls the
same `inspectSelected` and `planDelegation` stages used for a single model. The comparison records
every disposition, then selects the first eligible handoff. Absent or incompatible rows remain
visible even when a later candidate can take the task.

The managed adapter obtains one consistent snapshot from the installed local-model extension.
It projects selected rows into the existing inventory contract and records which refs were actually
read. A second extension read verifies that the assigned rows stayed stable across the workflow.
The read-only adapter grants no installation operation. Exact ordering and capability predicates
are checked independently by the managed system-test verifier.
