---
description: Run the caller-authorized installer using the observed baseline receipt.
args:
  baselineReceipt: string
returns: DeploymentAction
---
Call remoteDeploymentApply.apply(baselineReceipt). Return the receipt unchanged.
