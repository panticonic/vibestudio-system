---
description: Trace a client readiness issue across build, activation, runtime startup, and the user-visible check.
args:
  input: SystemClientInput
returns: SystemInvestigationReport
---
Ask selectAttempt(input) for the checks of exactly the requested revision, then call decideClient with those checks. An old runtime cannot verify a newly built revision. Preserve that distinction when reporting. Do not launch or alter clients.
