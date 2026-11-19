---
description: Obtain a fresh hub route and verify the actual child on it.
args:
  priorReceipt: string
returns: RemoteAccessReport
---
1. Call routeThroughHub with the prerequisite receipt. For failed return route-unavailable with a null workspaceId and its receipt.
2. Call observeChild with the route receipt. Use interpretChild and return its status, the route and child evidence IDs, and the child's workspaceId only when verified.
