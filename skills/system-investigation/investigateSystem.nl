---
description: Investigate an observed Vibestudio system condition within the caller's assigned diagnostic scope.
args:
  request: SystemInvestigationRequest
returns: SystemInvestigationReport
---
Select the child matching the typed investigation. Call comparePerformance for performance, traceClient for client development, traceRemote for remote access, assessModels for model readiness, readLogs for a suspected host-log incident, or auditClientSurface for a desktop or mobile client receipt audit. Forward its report exactly, including its evidence IDs. There is one conditional follow-up. When model-readiness returns a blocked model-engine finding and request.incidentLog is present, call readLogs for that exact follow-up and return both the model and log findings, in that order. Keep status blocked until the model inventory itself changes. Log recovery cannot establish that the assigned model is ready. The caller may use the report before doing separate work. Do not change the observed environment or claim a proposed fix ran.
