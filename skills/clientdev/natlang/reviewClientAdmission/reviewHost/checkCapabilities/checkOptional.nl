---
description: Identify optional contributions the assigned host would deny.
args:
  observation: ClientAdmissionObservation
returns: string[]
---
For each working optional capability, include it if absent from the host or if it is device-level and the client lacks published System trust. Return the exact names in manifest order.
