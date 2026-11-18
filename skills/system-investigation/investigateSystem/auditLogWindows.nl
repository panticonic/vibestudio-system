---
description: Compare the findings for exact, ordered windows of a live server log investigation.
args:
  input: SystemLogAuditInput
returns: SystemInvestigationReport
uses: [investigateSystem/readLogs]
---
1. In the input order, call readLogs with each supplied window. Preserve its status and findings as one entry in windows.
2. Concatenate those findings as the top-level findings in the original order.
3. Set the overall status to blocked if any window is blocked, else attention if any needs attention, else inconclusive if any is inconclusive, else ready. Return the overall status, findings, and windows.
