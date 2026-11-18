---
description: Inspect readiness of precisely the caller-selected local model.
args:
  ref: string
returns: LocalTaskObservation
uses: [assessment/interpretState]
---
Read row by awaiting localModelTaskInventory.inspect(ref). Call interpretState(row). Return row and its disposition. Never select another model when this ref is absent.
