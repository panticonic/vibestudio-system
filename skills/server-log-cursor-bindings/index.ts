import { mainRpcMethods } from "@vibestudio/service-schemas/mainRpc";
import { rpc } from "@workspace/runtime";
import type {
  ServerLogCursor,
  ServerLogCursorWindow,
} from "../server-logs/types.js";

type Input = {
  goal: string;
  saved: ServerLogCursor;
  throughSeq?: number;
  limit: number;
  tag: string;
  contains?: string;
};

export function bindServerLogCursor(input: Input) {
  const assignment = structuredClone(input);
  const { saved, limit, tag, contains } = assignment;
  const needle = contains?.toLowerCase();
  if (
    !saved.serverBootId ||
    !Number.isSafeInteger(saved.seq) ||
    saved.seq < 0 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 50 ||
    (assignment.throughSeq !== undefined &&
      (!Number.isSafeInteger(assignment.throughSeq) ||
        assignment.throughSeq < saved.seq))
  )
    throw new Error(
      "Assign a valid boot, sequence, and bounded host-log window",
    );
  const operationId = crypto.randomUUID();

  async function observe(): Promise<ServerLogCursorWindow> {
    const before = await rpc.call(
      "main",
      mainRpcMethods["serverLog.tail"],
      [1],
    );
    const stats = await rpc.call("main", mainRpcMethods["serverLog.stats"], []);
    const head = await rpc.call("main", mainRpcMethods["serverLog.tail"], [1]);
    const throughSeq = Math.min(
      assignment.throughSeq ?? head.latestSeq,
      head.latestSeq,
    );
    const base: ServerLogCursorWindow = {
      saved,
      liveBoot: head.serverBootId,
      latestSeq: head.latestSeq,
      throughSeq,
      oldestSeq: stats.oldestSeq,
      overflow: false,
      snapshot: null,
    };
    if (head.serverBootId !== saved.serverBootId || saved.seq > head.latestSeq)
      return base;
    if (
      before.serverBootId !== head.serverBootId ||
      (stats.oldestSeq !== null && saved.seq < stats.oldestSeq - 1)
    )
      return base;
    const observed = await rpc.call("main", mainRpcMethods["serverLog.query"], [
      {
        sinceSeq: saved.seq,
        untilSeq: throughSeq,
        limit: limit + 1,
        tag,
        ...(contains ? { contains } : {}),
      },
    ]);
    const after = await rpc.call("main", mainRpcMethods["serverLog.stats"], []);
    const final = await rpc.call("main", mainRpcMethods["serverLog.tail"], [1]);
    if (final.serverBootId !== saved.serverBootId)
      return {
        ...base,
        liveBoot: final.serverBootId,
        latestSeq: final.latestSeq,
      };
    if (
      observed.serverBootId !== saved.serverBootId ||
      observed.workspaceId !== head.workspaceId
    )
      return base;
    if (after.oldestSeq !== null && saved.seq < after.oldestSeq - 1)
      return {
        ...base,
        oldestSeq: after.oldestSeq,
        latestSeq: final.latestSeq,
      };
    if (observed.records.length > limit) return { ...base, overflow: true };
    if (
      observed.records.some(
        (record, index) =>
          record.tag !== tag ||
          record.seq <= saved.seq ||
          record.seq > throughSeq ||
          (index > 0 && record.seq <= observed.records[index - 1]!.seq) ||
          (needle && !record.message.toLowerCase().includes(needle)),
      )
    )
      throw new Error(
        "The host returned records outside the assigned log window",
      );
    return {
      ...base,
      latestSeq: final.latestSeq,
      snapshot: {
        serverBootId: observed.serverBootId,
        latestSeq: throughSeq,
        totalCaptured: stats.totalCaptured,
        records: observed.records.map(
          ({ seq, timestamp, level, tag, pid, message }) => ({
            seq,
            timestamp,
            level,
            tag,
            pid,
            message: message.slice(0, 500),
          }),
        ),
      },
    };
  }

  let receipt: Promise<ServerLogCursorWindow> | undefined;
  return {
    request: { goal: assignment.goal, operationId },
    services: {
      serverLogCursor: {
        async observe(id: string): Promise<ServerLogCursorWindow> {
          if (id !== operationId)
            throw new Error("Read only the caller's assigned log window");
          return structuredClone(await (receipt ??= observe()));
        },
      },
    },
  };
}
