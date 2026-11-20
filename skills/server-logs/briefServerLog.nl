---
description: Brief the user on the workspace server's host log, citing the server boot and sequence numbers so the evidence can be found again.
args:
  request: LogRequest
returns: LogBrief
uses: [classifyHostLogGroup]
budget: { maxTurns: 4, maxTokens: 6144 }
---
Call gather with request and condense the snapshot's records. In the same eval call
classifyHostLogGroup once for each group using Promise.all in group order. Return
assemble(snapshot, groups, classes) from eval so the boot and sequence evidence stays exact.
