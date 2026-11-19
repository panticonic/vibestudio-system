---
description: Bring up an assigned Vibestudio server and open the verified workspace for the caller's device.
args:
  request: RemoteDeploymentRequest
returns: RemoteCommissionReport
uses: [deployRemoteServer, openRemoteWorkspace]
budget: { maxTurns: 16 }
---
1. Call deployRemoteServer with request. Keep its full report as deployment.
2. If deployment.status is deployment-ready or already-running, pass its final evidence receipt to bindVerifiedWorkspace. Otherwise return deployment with null handoff and access.
3. If the handoff is assigned, call openRemoteWorkspace with the returned operationId. Return both reports and the handoff. If the deployment changed, return deployment and handoff with null access.
