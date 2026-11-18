---
description: Decide whether the user actually asked for a permitted persistent model installation.
args:
  request: LocalTaskRequest
  initial: LocalTaskObservation
returns: '"install" | "confirm" | "skip"'
---
1. Inspection means skip. Skip when initial.disposition is anything except needs-install. Existing progress is owned by its existing operation.
2. A prepare or delegate request with mayInstall true authorizes installing the exact selected missing model. Return install.
3. Return confirm when the user asks to prepare or delegate without authorizing installation of the missing model.
