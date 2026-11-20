---
description: Identify the exact remaining checkpoint needed after a partial or changed incident observation.
args:
  goal: string
  checkpoints: DiagnosticSource[]
  inspections: Inspection[]
returns: string | null
---
1. Check whether the goal's needed evidence was observed. A foreign boot, overflowing window, stale checkpoint, unrelated trace or progress-only signal may justify a second observation.
2. Select one unread owned checkpoint when the user requests a fallback and its title, operation and coverage match that fallback. A narrower interval can address a broad read only for evidence within the narrower interval. Current-boot evidence after an old cursor can be reported separately when requested, but cannot complete the gap across the restart.
3. Return null when the current evidence suffices, when the goal forbids a follow-up, or when no alternative matches. Do not choose an unrelated probe just to return an answer.
