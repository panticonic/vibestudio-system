---
description: Locate the earliest blocked stage of the requested client revision.
args:
  checks: SystemClientEvidence[]
returns: SystemInvestigationReport
---
Evaluate build, activation, runtime, and user-check in that dependency order. A failed stage with all preceding stages passed produces blocked with code equal to its stage and evidenceIds containing the failing receipt. For a missing or skipped prerequisite, return inconclusive with code incomplete-attempt and cite the skipped receipt if present. When every stage passed return ready, code verified-client, and cite the actual user-check receipt. Use one finding. Do not count successful work from another revision.
