---
description: Check runtime ABI and capability availability separately.
args:
  observation: ClientAdmissionObservation
returns: ClientHostReview
---
Call checkAbi and checkCapabilities, each with observation. Return the two outcomes unchanged as abi and capabilities.
