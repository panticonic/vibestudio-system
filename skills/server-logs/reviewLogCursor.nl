---
description: Review an assigned saved host-log cursor and summarize its exact bounded window when resumable.
args:
  request: ServerLogCursorRequest
returns: ServerLogCursorReport
uses: [summarizeLogSnapshot]
---
1. Call serverLogCursor.observe with request.operationId. Call checkCursor using its exact observed window.
2. For review-window with a snapshot, call summarizeLogSnapshot with that snapshot. Use next {serverBootId: liveBoot, seq: throughSeq}. The bounded window has been reviewed even when no records matched its filter.
3. Otherwise return null brief and null next. Return the decision, exact liveBoot and latestSeq in every case.
