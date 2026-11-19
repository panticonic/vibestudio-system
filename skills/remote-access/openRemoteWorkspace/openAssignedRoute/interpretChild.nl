---
description: Distinguish an authenticated child confirmation from a routing failure.
args:
  child: RemoteChildReceipt
returns: RemoteAccessDisposition
---
Return workspace-ready for verified, child-identity-mismatch for identity-mismatch, and child-unreachable for unreachable.
