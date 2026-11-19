---
description: Interpret the saved boot and sequence against the actual current buffer.
args:
  window: ServerLogCursorWindow
returns: ServerLogCursorDecision
---
Call compareBoot with window.saved.serverBootId and window.liveBoot. When different, return reset-for-new-boot with the reason. For the same boot call checkCoverage with window and return its exact result.
