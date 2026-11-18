---
description: Decide whether a mobile installation actually passed its device, attempt, and workspace readiness probe.
args:
  evidence: SystemMobileProbeAudit
returns: SystemInvestigationReport
---
Use only receipts with evidence.expectedAttempt. Android device or emulator receipts require adb and simulator receipts require simctl. A physical iOS device cannot supply a simctl log stream. When such a stream appears in the selected attempt, return inconclusive with code unsupported-physical-ios-stream and cite it. Otherwise require observed installed, launched and workspace-ready receipts for the requested attempt and compatible backend. A failed workspace readiness receipt from the compatible backend gives blocked with code mobile-workspace-check-failed, citing that receipt. A full verified chain gives ready with code mobile-workspace-verified, citing the ready receipt. For an incomplete chain return inconclusive with code mobile-attempt-incomplete and cite the last observed compatible receipt if any. Return one finding.
