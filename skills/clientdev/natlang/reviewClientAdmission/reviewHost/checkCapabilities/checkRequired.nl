---
description: Identify required client capabilities that prevent admission.
args:
  observation: ClientAdmissionObservation
returns: RequiredClientCapabilityReview
---
List each working required capability absent from the assigned host under missingRequired. List each device-level working required capability not covered by published System trust under untrustedRequired. These checks are independent. Return exact names in manifest order.
