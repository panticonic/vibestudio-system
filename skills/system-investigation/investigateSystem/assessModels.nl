---
description: Assess readiness of the exact assigned local model from Vibestudio's local-model inventory.
args:
  input: SystemModelsInput
returns: SystemInvestigationReport
---
Read localModels.listModels once and select the row whose slug exactly matches input.slug. Call assessModelState with that row or null, and the requested slug. Do not install, start, or choose a hosted service. Preserve the child's report.
