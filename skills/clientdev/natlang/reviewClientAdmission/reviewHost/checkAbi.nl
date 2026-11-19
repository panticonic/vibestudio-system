---
description: Match the working client runtime and exact ABI to the selected host.
args:
  observation: ClientAdmissionObservation
returns: 'ClientHostReview["abi"]'
---
Look up the host ABI for the working client runtime. Missing runtime means wrong-runtime. If the ABI exists but differs from the working manifest ABI return wrong-abi. An exact match is compatible.
