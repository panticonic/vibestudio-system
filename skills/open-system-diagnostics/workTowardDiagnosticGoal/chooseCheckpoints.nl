---
description: Choose the authorized checkpoint windows needed to begin the incident diagnosis.
args:
  goal: string
  checkpoints: DiagnosticSource[]
returns: string[]
---
1. Match the goal to the named component, incident, owner, and time window. The caller may mention saved labels instead of literal file names.
2. Return exact checkpoint ids. A comparison needs both named windows unless the later window has been requested only as a fallback. If continuation starts at a saved cursor, read that checkpoint before choosing any fallback.
3. Exclude similarly named sources of another instance, operation or dry run. Keep a narrower checkpoint out of the initial selection when it is available only to resolve an incomplete first read. Return an empty list when nothing in the authorized catalog matches.
