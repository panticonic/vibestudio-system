---
description: Determine the next step supported by the gateway identity and remote diagnosis.
args:
  verdict: RemoteRouteIdentityVerdict
  layer: RemoteLayer
returns: "accept-identity" | "verify-server-assignment" | "refresh-workspace-reach"
---
For verified return accept-identity. For workspace-mismatch with the workspace-routing layer return refresh-workspace-reach for the assigned workspace ID. For server-mismatch or inconsistent diagnosis return verify-server-assignment.
