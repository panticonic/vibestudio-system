---
description: Judge comparable repeated measurements at a single user-visible boundary.
args:
  input: SystemPerformanceInput
returns: SystemInvestigationReport
---
Call compare(input) for the exact pairing and median. Call interpretComparison with the calculation and both run IDs. Preserve the result. Do not ascribe a measured change to an unobserved component.
