---
description: Check the chosen coordinate against the authenticated workspace and the caller's context.
args:
  choice: CliContextChoice
  gateway: RemoteGatewayIdentity
  credential: 'CliContextEvidence["credential"]'
returns: CliContextStatus
---
1. A missing coordinate is unattached.
2. If a workspace ID or server ID on the coordinate differs from the gateway, return foreign-workspace.
3. An agent credential bound to a different context yields foreign-context. Otherwise return usable.
