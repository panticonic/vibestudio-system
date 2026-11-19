import { expect, it, vi, beforeEach } from "vitest";
import { mainRpcMethods } from "@vibestudio/service-schemas/mainRpc";
import { bindServerLogCursor } from "./index.js";

const { call } = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("@workspace/runtime", () => ({ rpc: { call } }));
const live = {
  serverBootId: "live",
  latestSeq: 30,
  workspaceId: "workspace",
  records: [],
};
const record = {
  seq: 22,
  timestamp: 2000,
  level: "warn",
  tag: "Workspace",
  pid: 7,
  message: "owned event",
};
beforeEach(() => {
  call.mockReset();
  call.mockImplementation(async (_target, method) => {
    if (method === mainRpcMethods["serverLog.tail"]) return live;
    if (method === mainRpcMethods["serverLog.stats"])
      return { oldestSeq: 10, totalCaptured: 30 };
    if (method === mainRpcMethods["serverLog.query"])
      return { ...live, records: [record] };
    throw new Error("Unexpected host method");
  });
});

it("preserves an exact covered cursor and seals the bounded filter", async () => {
  const { request, services } = bindServerLogCursor({
    goal: "Review the captured window",
    saved: { serverBootId: "live", seq: 20 },
    throughSeq: 25,
    tag: "Workspace",
    contains: "OWNED",
    limit: 3,
  });
  await expect(services.serverLogCursor.observe("unassigned")).rejects.toThrow(
    "assigned",
  );
  await expect(
    services.serverLogCursor.observe(request.operationId),
  ).resolves.toMatchObject({
    liveBoot: "live",
    latestSeq: 30,
    throughSeq: 25,
    overflow: false,
    snapshot: { serverBootId: "live", latestSeq: 25, records: [record] },
  });
  expect(call).toHaveBeenCalledWith("main", mainRpcMethods["serverLog.query"], [
    {
      sinceSeq: 20,
      untilSeq: 25,
      tag: "Workspace",
      contains: "OWNED",
      limit: 4,
    },
  ]);
});

it("leaves a previous boot and expired sequence without a resumable observation", async () => {
  for (const saved of [
    { serverBootId: "old", seq: 20 },
    { serverBootId: "live", seq: 5 },
  ]) {
    const { request, services } = bindServerLogCursor({
      goal: "Check resumption",
      saved,
      tag: "Workspace",
      limit: 3,
    });
    await expect(
      services.serverLogCursor.observe(request.operationId),
    ).resolves.toMatchObject({
      liveBoot: "live",
      oldestSeq: 10,
      snapshot: null,
    });
  }
  expect(
    call.mock.calls.some(
      ([, method]) => method === mainRpcMethods["serverLog.query"],
    ),
  ).toBe(false);
});
