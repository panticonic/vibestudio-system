---
description: Separate independent transport reachability from workspace routing and child readiness.
args:
  checks: SystemRemoteEvidence[]
returns: SystemInvestigationReport
---
Inspect device-runtime, host-runtime, hub, workspace and endpoint in dependency order. The first failed phase after passed prerequisites means blocked, with its phase as the code and its receipt ID as evidence. If a prerequisite is skipped or absent, report inconclusive with code incomplete-route and cite the skipped receipt when present. If all passed, report ready with code verified-route and cite the endpoint receipt. Output one finding. Never propose exposing an endpoint, changing authorization, or treating skipped work as successful.
