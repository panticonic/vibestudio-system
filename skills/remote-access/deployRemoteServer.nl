---
description: Deploy or update the caller's assigned Vibestudio server and verify the managed workspace after startup.
args:
  request: RemoteDeploymentRequest
returns: RemoteDeploymentReport
budget: { maxTurns: 24 }
---
1. Call observeBaseline with request.operationId and decideDeployment with the returned baseline. If the decision is a terminal status, return it with the baseline receipt and a null identity.
2. For apply, call applyDeployment with the baseline receipt. If the installer failed return installer-failed. If the baseline changed return baseline-changed. Both reports cite the baseline and attempt receipts and carry null identity.
3. After an applied result call checkReadiness with its receipt. Keep its status and verified identity. Prepend the baseline and installer receipts to its evidence IDs.
