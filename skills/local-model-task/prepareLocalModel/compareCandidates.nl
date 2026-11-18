---
description: Compare the assigned local models using their real inventory rows and the task's requirements.
args:
  request: LocalTaskRequest
returns: LocalTaskReport
---
1. Visit request.modelRef followed by request.alternatives, in exactly that order. For every ref call reviewCandidate with the same task requirements. Retain the entire ordered candidate list.
2. Select the first candidate with a handoff. If there is one, return its disposition, ref, state and handoff. If none qualifies return no-candidate, the primary ref, null state and null handoff.
3. In both cases return the ordered candidates and a null installation receipt.
