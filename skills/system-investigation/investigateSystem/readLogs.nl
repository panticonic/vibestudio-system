---
description: Investigate a bounded part of the host log tied to one boot, cursor, and subsystem.
args:
  input: SystemLogInput
returns: SystemInvestigationReport
---
Call serverLog.query with input.sinceSeq, input.tag, and limit 100. If serverBootId differs from input.expectedBoot, return inconclusive with code log-boot-changed and the observed boot ID as evidence. A previous boot's cursor cannot establish what is happening on the new boot. Otherwise pass only records strictly after the requested cursor with the exact tag to interpretLogWindow, with the observed boot ID. Return the child's finding.
