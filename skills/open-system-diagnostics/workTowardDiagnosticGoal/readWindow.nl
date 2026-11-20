---
description: Read a live bounded log checkpoint and interpret only the evidence it contains.
args:
  goal: string
  sourceId: string
returns: Inspection
---
Call diagnosticLog.read with the exact sourceId. Call interpretWindow on the actual window and goal. Return both unchanged.
