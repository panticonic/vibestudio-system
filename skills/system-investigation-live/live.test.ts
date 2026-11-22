import { expect, it } from "vitest";
import { prepareManagedLogAudit, workerdLogTag } from "./live.js";

function prepare() {
  const seed = { marker: "owned-seed", boot: "boot", workspaceId: "workspace", start: 0, steps: [1, 2] };
  return prepareManagedLogAudit(async filter => ({
    serverBootId: seed.boot, workspaceId: seed.workspaceId, latestSeq: 2,
    records: filter.tag === workerdLogTag ? seed.steps.filter(seq => seq > filter.sinceSeq).slice(0, filter.limit)
      .map(seq => ({ seq, timestamp: seq, level: "info" as const, tag: workerdLogTag, message: `owned-seed line-${seq}` })) : [],
  }), "context", {
    id: "incident", goal: "Investigate the current incident", lines: ["line-1", "line-2"], windows: [
      { title: "full", cursor: null, tag: workerdLogTag, status: "ready", code: "full", evidence: [0, 1] },
      { title: "recent", cursor: 0, tag: workerdLogTag, status: "ready", code: "recent", evidence: [1] },
    ],
  }, seed);
}

it("accepts any order, repeated reads and bounded partial exploration of authorized log windows", async () => {
  const log = prepare();
  const query = log.services.serverLog.query;
  await query({ sinceSeq: 1, tag: workerdLogTag, limit: 100 });
  await query({ sinceSeq: 0, tag: workerdLogTag, limit: 1 });
  expect(log.verify(log.expected).passed).toBe(false);
  await query({ sinceSeq: 0, tag: workerdLogTag, limit: 100 });
  await query({ sinceSeq: 1, tag: workerdLogTag, limit: 100 });
  expect(log.verify(log.expected).passed).toBe(true);
  await expect(query({ sinceSeq: 99, tag: workerdLogTag, limit: 100 })).rejects.toThrow("assigned host log window");
  expect(log.verify({ ...log.expected, status: "blocked" }).passed).toBe(false);
});
