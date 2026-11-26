---
description: Plan one Vibestudio CLI command after verifying its workspace gateway.
args:
  request: RemoteRouteReviewRequest
returns: CliContinuation
---
1. Read remoteCliScope.evidence with request.operationId. Keep the authenticated gateway.
2. Call selectContextSource with the supplied selectors. Call assessCliContext with the selection, gateway and credential.
3. Return source, selected context ID or null, assessment as status, and the exact gateway. This is the selected authenticated execution scope, not a grant to execute the command. Credential kind alone does not establish operation permission or a blanket requirement for parent execution. A linked agent may request eval in its own bound entity/context; actual operations still undergo their native authority and admission checks.
