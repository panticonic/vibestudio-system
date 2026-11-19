---
description: Interpret readiness, boot transition and preserved server identity.
args:
  verified: DeploymentVerification
returns: RemoteDeploymentStatus
---
Return deployment-ready for verified. Return readiness-unverified for unready, boot-unchanged for unchanged-boot, or server-identity-changed for identity-changed.
