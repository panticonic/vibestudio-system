---
description: Plan one Vibestudio CLI command after verifying its workspace gateway.
args:
  request: RemoteRouteReviewRequest
returns: CliContinuation
---
1. Read remoteCliScope.evidence with request.operationId. Keep the authenticated gateway.
2. Call selectContextSource with the supplied selectors. Call assessCliContext with the selection, gateway and credential. Then call chooseCliAction with the assessment, credential and requested operation.
3. Return source, selected context ID or null, assessment as status, next action, and the exact gateway.
