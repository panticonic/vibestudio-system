---
description: Prepare the caller-selected local model and return a readiness handoff supported by current inventory.
args:
  request: LocalTaskRequest
returns: LocalTaskReport
---
For a compare request, call compareCandidates with the exact assignment and return its report. For any other operation use these steps:

1. Call inspectSelected(request.modelRef). Preserve the exact ref and observed state throughout.
2. Call decideInstallation(request, initial). When it returns install, call applyInstallation(request.modelRef) exactly once. If it throws, keep the installation failure and do not retry or delegate. Return installation-rejected with the initial state and null receipt and handoff. If it returns a receipt, call readOutcome(request.modelRef, receipt) and use the returned observation as current. Otherwise use the initial observation; when the decision is confirm, use needs-install-confirmation.
3. If request.operation is delegate and the current disposition is usable, call planDelegation(request, current.row). Use its returned disposition and handoff. Only give a handoff for the exact ref when the task's tool and context needs are met.
4. Return the final disposition, the exact model ref, the final observed state or null, the actual receipt if any, and the handoff or null. Preparation does not launch the model or execute the delegated task.
