---
description: Decide whether to inspect, hold, start or restart based on observed readiness and the current grant.
args:
  action: OperatorAction
  baseline: OperatorBaseline
returns: DeploymentDecision
---
1. With an unverified baseline return unverified with reason baseline-unverified. For inspect return the observed ready or inactive status without a write.
2. For ensure-ready with a ready baseline return ready without a write. Otherwise ensure-ready needs the start grant, and recommend start only with that grant.
3. For restart, require an observed ready baseline and its prior identity. If either is missing return held with reason prior-identity-required. Otherwise restart needs the restart grant.
4. If the required grant is absent return held with reason approval-required. For the authorized case return the exact operation in an apply decision.
