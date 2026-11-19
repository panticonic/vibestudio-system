---
description: Inspect the exact working and published client contracts before comparing host support.
args:
  operationId: string
returns: ClientSourceReview
---
Call readClient with operationId. Compare the working and published manifest hashes. Return working-change when they differ or published-contract when equal, along with the exact observation.
