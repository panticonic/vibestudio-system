---
description: Decide how the later host-log evidence changes the earlier incident handoff.
readout: decision
args:
  goal: string
  earlier: LogBrief
  later: LogBrief
returns: HostLogProgress
---
Use the goal to identify the relevant service or operation. Compare the meaning of the
findings and their subsystems across the two windows. Choose one status.

- insufficient-evidence: a window has no matching records.
- recurring-failure: the later window shows the same relevant failing operation and symptom again.
- new-failure: the later window shows a relevant failure with no matching earlier failure.
- needs-attention: the later window shows relevant degradation requiring follow-up and no relevant failure.
- quiet-after-failure: the earlier window shows a relevant failure and the later window has matching records
  with neither relevant failure nor degradation. This only describes the observed window.
- steady: the windows contain relevant activity without findings that require follow-up.
