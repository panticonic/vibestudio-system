---
description: Inspect an observed desktop or mobile client contract without mutating the client, device or account.
args:
  input: SystemClientSurfaceInput
returns: SystemInvestigationReport
---
Route workspace-interaction to inspectInteraction, pairing to inspectPairing, bootstrap to inspectBootstrap, and mobile-probe to inspectMobileProbe. Pass only the typed observation. The child owns its evidence and returns the finding to forward. A UI gesture, build, or successful installation alone does not prove the requested behavior.
