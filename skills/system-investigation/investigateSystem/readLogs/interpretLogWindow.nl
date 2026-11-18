---
description: Distinguish an unresolved host-log incident from an explicit recovery or routine activity.
args:
  boot: string
  records: SystemLogRecord[]
returns: SystemInvestigationReport
---
Return a single finding. Cite individual records as <boot>:<seq>. When an operation failed and a later line explicitly confirms recovery of that same operation, return attention with code log-recovered and cite both records. When a failure has no corresponding recovery, return blocked with code log-unresolved and cite the failure. When the window has only routine observations, return ready with code log-routine and cite a routine receipt. When the window has no records, return inconclusive with code log-no-observations and an empty evidence list. A generic healthy heartbeat or recovery for another operation leaves the original failure unresolved.
