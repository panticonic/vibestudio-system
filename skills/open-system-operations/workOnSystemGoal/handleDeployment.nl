---
description: Resolve a readiness or deployment goal against the actual observed server boundary.
args:
  choice: OperatorChoice
  baseline: OperatorBaseline
returns: OperatorReport
budget: { maxTurns: 18 }
---
1. Call decideLifecycle with the chosen action and baseline. For a report decision, return its status and reason with baseline.target.id, baseline.identity, and the baseline receipt as the only evidence.
2. For an apply decision, call applyAndVerify and return the actual result unchanged.
