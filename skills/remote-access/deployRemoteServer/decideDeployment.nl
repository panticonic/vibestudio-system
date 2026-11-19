---
description: Choose when to invoke the installer from the agreed operation and observed managed service.
args:
  baseline: DeploymentBaseline
returns: "apply" | "already-running" | "baseline-unverified" | "update-needs-existing-server"
---
Return baseline-unverified for unverified. For an update return apply only when the baseline has a prior identity, otherwise update-needs-existing-server. For deployment return already-running when ready, or apply when inactive.
