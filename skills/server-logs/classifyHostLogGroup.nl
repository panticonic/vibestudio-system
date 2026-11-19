---
description: Decide what one group of identical host log lines means for the workspace server.
readout: decision
args:
  group: LogGroup
returns: LogClass
---
Classify group, lines of the workspace server's host log that say the same thing (group.count of them, from
group.firstSeq to group.lastSeq). Read what the message says happened; the level is only a hint.

- routine: the server doing its normal work. Services starting, registering and becoming ready, listening ports,
  timings reported while starting up, workers and Durable Objects being prepared, shutdown stages, build and cache
  bookkeeping, relay connection notices, requests served, and the sandbox runtime's own start-up notices (it prints
  "Removing unpermitted intrinsics" lines at warn level on every start; they are always routine).
- notable: the server noticed a problem and kept going. The message says something is slow ("state=slow", "has been
  active for 10s"), exceeded a budget or threshold, was retried, is deprecated or experimental (a Node.js process
  warning such as "DeprecationWarning" or "ExperimentalWarning"), or that a client disconnected.
- failure: something did not work: an operation failed, was refused, timed out, threw, or was left unusable; an
  error message with a cause; a process that exited unexpectedly.
