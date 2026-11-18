---
description: Reinspect the model after an installation receipt and evaluate its current readiness.
args:
  ref: string
  receipt: LocalTaskReceipt
returns: LocalTaskObservation
uses: [assessment/interpretState]
---
Read row by awaiting localModelTaskInventory.inspect(ref). Call interpretState(row) and pass the disposition and receipt to resolveOutcome. Return row with the resolved disposition.
