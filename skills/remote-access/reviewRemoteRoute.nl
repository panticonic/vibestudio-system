---
description: Review the authenticated identity of the workspace gateway reached by a caller-assigned route.
uses: [remoteLayer]
args:
  request: RemoteRouteReviewRequest
returns: RemoteRouteReview
---
1. Call readGatewayIdentity with request.operationId. Keep the actual observed server, boot and workspace identifiers unchanged.
2. Call compareGatewayIdentity with the request and observed identity. Keep its verdict and use its diagnostic as the input to remoteLayer.
3. Call routeHandoff with the exact verdict and layer. Return the observed identity, verdict, layer and next action. Treat this as a route identity check, not a new pairing or a transport health claim.
