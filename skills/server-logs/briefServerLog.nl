---
description: Brief the user on the workspace server's host log, citing the server boot and sequence numbers so the evidence can be found again.
args:
  request: LogRequest
returns: LogBrief
budget: { turnTokens: 1024 }
---
Call collect with request and return its result. It reads one bounded window of the host log, collapses repeated lines,
judges each group and assembles the brief. Return the value exactly as collect gave it, from eval, so the boot
identity and sequence numbers stay exact.
