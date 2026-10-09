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
