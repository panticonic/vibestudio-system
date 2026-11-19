---
description: Identify absent required, untrusted required, and unavailable optional capabilities.
args:
  observation: ClientAdmissionObservation
returns: ClientCapabilityReview
---
Call checkRequired and checkOptional with the same observation. Keep the two required blocker lists and put the optional result in deniedOptional. Return all three lists unchanged.
