---
description: Verify the managed hub and child workspace after the installer.
args:
  actionReceipt: string
returns: RemoteDeploymentReport
---
Call observeReadiness with actionReceipt, then interpretReadiness with the resulting receipt. Return the status and readiness receipt. Include the identity only for deployment-ready.
