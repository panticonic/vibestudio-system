---
description: Pair or resume the assigned device profile and verify its connection to the selected Vibestudio workspace.
args:
  request: RemoteAccessRequest
returns: RemoteAccessReport
budget: { maxTurns: 24 }
---
1. Call readAssignedProfile with request.operationId. Use decideAdmission with the readback. For invite-required, different-profile, or recover-profile, return that status with the profile receipt and a null workspaceId.
2. For pair, call pairAssignedProfile with the profile receipt. On failure return pairing-failed and cite the profile and pairing receipts. On success use the pairing receipt as the next prerequisite. For route, use the existing profile receipt as the prerequisite.
3. Call openAssignedRoute with the prerequisite receipt. Prepend the profile and any pairing evidence to the returned route and child evidence. Keep the route report's status and workspaceId.
