---
name: server-logs
description: Query, summarize, or live-follow the workspace server's structured host-process logs, or direct a user to the Server Logs viewer.
---

# Server logs

`serverLog` covers the workspace server process: startup, builds, RPC,
supervision, Git, reconnects, and other host subsystems. For the logs of one
specific panel, app, extension, worker, or Durable Object instance, use
`runtime.supervision.logs(identity)` instead.

The service is read-only and redacts known secrets when records are captured,
but normal access checks still apply to callers. See the live docs for the
current filters, fields, limits, and event schemas.

## Bounded inspection

```ts
const snapshot = await services.serverLog.tail(200);
const warnings = await services.serverLog.query({
  level: "warn",
  sinceSeq: snapshot.latestSeq,
  limit: 100,
});
// Return the snapshot's identity and the records that support the finding, not
// the whole buffers. A full tail of complete records runs to tens of thousands
// of characters and is returned windowed into `scope.$lastLargeReturn`, which
// drops the identity fields from your own answer.
const brief = (record) => ({
  seq: record.seq,
  level: record.level,
  tag: record.tag,
  message: record.message,
});
return {
  serverBootId: snapshot.serverBootId,
  latestSeq: snapshot.latestSeq,
  records: snapshot.records.slice(-10).map(brief),
  warnings: warnings.records.slice(-10).map(brief),
};
```

Call `stats()` to see which subsystem tags are active before filtering. Combine
level, time, sequence, tag, and text filters rather than fetching the whole
buffer. Every response includes a boot ID and the latest sequence number; reset
your cursor when the boot ID changes.

## A typed brief, as an aid

`briefServerLog.collect` reads one window, collapses repeated lines, and has a
small model judge each distinct group as routine, notable, or a failure. Code
reads the log and copies the identity, so the boot, the sequence numbers and the
counts are exact. The judgments are not: on the locked test split the small model
got 3 of 5 windows exactly right and read a failed worker preparation as merely
notable and a duplicate-route warning as routine. Treat its findings as
candidates, check them against the raw lines from the bounded inspection above,
and decide the status yourself.

```ts
const brief = await natlang.load("skills/server-logs/briefServerLog.nl");
const report: LogBrief = await brief.collect({ level: "warn" });
return report;
```

`since` (epoch milliseconds) and `level` (lowest level to read) are both
optional; with neither, the brief reads the newest 300 lines. The result:

- `serverBootId` and `latestSeq`: quote both so the evidence can be found
  again, and reset any cursor when the boot changes.
- `window`: the first and last sequence number read, and how many lines.
- `status`: `incident` when any finding is a failure, `attention` when any is
  notable, otherwise `normal`.
- `findings`: the groups the small model did not call routine, failures first.
  Each carries the first line as captured, its `count`, and `firstSeq`..`lastSeq`.
- `headline`: one line of counts (failures and notable groups in how many lines).

Each distinct group of lines costs one small-model decision (about 25 seconds on a
CPU laptop), so a brief of a whole boot takes minutes. Filter first when the
question is "is anything wrong?": `level: "warn"` leaves a handful of groups.

A `normal` brief with warn-level lines is expected: the sandbox runtime prints
start-up notices at `warn`.

For a caller-assigned saved cursor, the shared Natlang program exposes
`serverLogs/reviewLogCursor`. It checks the current boot and retained
sequence range, and proposes a new cursor only after reviewing the bounded
window. [Workflow design](DECOMPOSITION.md#saved-cursor-review).

## Live following

For short investigations, repeat bounded queries with `sinceSeq`. A real live
viewer should subscribe to `server-log:append` before catching up from its last
sequence number, deduplicate by sequence number, and cancel the subscription on
teardown. Don't leave a background follower running that nothing will cancel.

The `about/server-logs` panel already shows live logs and is usually a better
choice than dumping raw records into chat.

## Offline and remote logs

The server also writes structured JSONL logs to its state directory, so they
can be inspected after the process exits. Desktop supervisors and remote
service managers may keep their own stdout/stderr or journal. For deployed
servers, use the remote-access CLI's log command. Don't assume a workspace agent
can read host filesystem paths directly.

The in-memory ring buffer only covers the current boot; it is not an archive.
Keep queries bounded. In every report, include the snapshot's `serverBootId`
and `latestSeq` so the evidence can be found again, and quote only the records
needed to explain the incident.
