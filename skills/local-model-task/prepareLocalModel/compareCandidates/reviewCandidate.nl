---
description: Assess one already-assigned candidate for this task.
args:
  ref: string
  request: LocalTaskRequest
returns: LocalTaskCandidate
uses: [prepareLocalModel/inspectSelected, prepareLocalModel/planDelegation]
---
1. Call inspectSelected(ref). Take the state from its returned row, or null if absent.
2. If the disposition is usable, call planDelegation with the original task constraints and ref as modelRef. Return its exact disposition and handoff with ref and state.
3. For every other disposition return ref, state, the observed disposition and null handoff.
