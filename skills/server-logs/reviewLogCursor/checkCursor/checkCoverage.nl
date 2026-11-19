---
description: Decide whether to advance the saved sequence after this exact bounded read.
args:
  window: ServerLogCursorWindow
returns: ServerLogCursorDecision
---
1. A saved sequence above latestSeq is future-cursor.
2. A saved sequence below oldestSeq minus one means needed records are gone. Use backfill.
3. Overflow means the bounded query cannot establish complete coverage. Use narrow-window and retain the saved sequence.
4. A present snapshot supports review-window through the recorded throughSeq. If the snapshot is absent after these checks, use backfill and explain the missing observation.
