---
description: Select the next measurement or investigation from the available build evidence.
args:
  goal: string
  observation: BuildPerformanceObservation
  execution: BuildRunAssessment
  payload: PayloadAssessment | null
returns: BuildPerformanceFollowup
---
Return a BuildPerformanceFollowup containing the recommended action and its reason, using only the supplied measurements.

1. If the build failed or was skipped, recommend diagnose-build and name the observed failure or missing build.
2. For an over-budget initial payload, recommend reduce-initial-payload and name the largest measured initial input if one is available. In reason, explain that a proposed change should be confirmed using the same native payload metric on the changed state.
3. If the repeat had different keys or the goal is about cache and the repeat is unverified, recommend establish-cache with a repeat against the exact same state and keys.
4. If a single phase dominated a measured build and the goal concerns build time, recommend measure-phase and name that phase. Otherwise record-baseline and indicate whether this was a build or a preexisting artifact.
