import type {
  RemoteGatewayIdentity,
  RemoteRouteIdentityVerdict,
  RemoteRouteReviewRequest,
} from "../types.js";

export default function compareGatewayIdentity(
  request: RemoteRouteReviewRequest,
  observed: RemoteGatewayIdentity,
): { verdict: RemoteRouteIdentityVerdict; diagnostic: string } {
  if (observed.serverId !== request.serverId) {
    return {
      verdict: "server-mismatch",
      diagnostic:
        "The paired control reach does not belong to the assigned server identity.",
    };
  }
  if (observed.workspaceId !== request.workspaceId) {
    return {
      verdict: "workspace-mismatch",
      diagnostic:
        "The gateway answered, but the selected workspace route reaches a different workspace ID.",
    };
  }
  return {
    verdict: "verified",
    diagnostic:
      "The server and workspace gateway identities match the assigned route.",
  };
}
