---
description: Review the assigned System client against its current source, host profile and published build catalog.
args:
  request: ClientAdmissionRequest
returns: ClientAdmissionReview
---
1. Call inspectSource with request.operationId. Call reviewHost with the exact observation it returns.
2. Call chooseNext with both reviews. Return the original reviews and chosen decision. Report compatibility and evidence, never a device launch or grant.
