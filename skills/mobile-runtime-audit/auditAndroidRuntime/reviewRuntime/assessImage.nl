---
description: Check whether the native observation actually contains a captured device image.
args:
  observation: AndroidRuntimeObservation
returns: AndroidImageEvidence
---
Return captured only when the native capture flag is true and screenshotBytes is positive. Otherwise return unavailable. A device image proves capture only.
