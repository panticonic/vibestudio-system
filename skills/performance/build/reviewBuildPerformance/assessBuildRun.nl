---
description: Establish the conditions of the first and repeat build measurements.
args:
  observation: BuildPerformanceObservation
returns: BuildRunAssessment
---
1. A failed or skipped build is unavailable for performance comparison. Return unavailable for state, repeat and phase.
2. Map built-during-profile to built, preexisting to preexisting and unknown to unknown.
3. A repeat is verified only when it exists, there is at least one observed target and sameBuildKeys is true. A repeat that explicitly has different keys is different-keys. Otherwise the repeat is unavailable.
4. Only when state is built and first.phases is present and has a positive duration, call identifyPhase with those timings. Otherwise the phase is unavailable.
