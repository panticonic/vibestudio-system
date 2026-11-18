---
description: Interpret an exact repeated performance comparison as a readiness finding.
args:
  comparison: SystemPerformanceComparison
  runIds: string[]
returns: SystemInvestigationReport
---
Return one finding with the comparison.verdict as its code and both runIds as evidence. For incomparable or insufficient-samples return inconclusive. For regression return attention. For within-budget return ready. Treat the evidence as measurements of the sampled boundary only.
