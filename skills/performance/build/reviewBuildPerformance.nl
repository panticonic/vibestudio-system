---
description: Interpret an assigned workspace unit's native build, cache and payload measurements.
args:
  request: BuildPerformanceRequest
returns: BuildPerformanceReport
---
1. Call buildPerformance.observe with request.operationId. Pass the exact observation to assessBuildRun.
2. If the build succeeded and its runtime target has a payload report, call reviewPayload with that payload and the optional initial budget. Otherwise use null.
3. Call chooseFollowup with the request goal, observation, execution assessment and payload assessment. Return the observation and all three results unchanged.
