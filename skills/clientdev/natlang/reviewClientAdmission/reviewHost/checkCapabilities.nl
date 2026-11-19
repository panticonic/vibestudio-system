---
description: Identify absent required, untrusted required, and unavailable optional capabilities.
args:
  observation: ClientAdmissionObservation
returns: ClientCapabilityReview
---
For each required capability, list it under missingRequired if the host does not implement it, and under untrustedRequired if it is device-level and the published System trust does not include the client. List each optional capability under deniedOptional if either of those reasons applies. Use the exact names in the input. Keep each array in manifest order.
