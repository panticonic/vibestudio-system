import type {
  LocalTaskReport,
  LocalTaskRequest,
} from "../local-model-task/types.js";
import { prepareLocalModelComparison } from "@workspace-skills/local-model-task-bindings/live";
import type { LocalTaskExtensionPort } from "@workspace-skills/local-model-task-bindings";
import type { SystemInvestigationReport } from "../system-investigation/types.js";
import type { prepareManagedLogAudit } from "./live.js";

export function prepareIncidentContinuation(
  contextId: string,
  caseId: string,
  goal: string,
  log: ReturnType<typeof prepareManagedLogAudit>,
  extensions: LocalTaskExtensionPort,
  modelWorld: { id: string; request: LocalTaskRequest },
) {
  const queryLog = log.services.serverLog.query;
  const windowCount = log.request.windows.length;
  const models = modelWorld.request;
  const refs = [models.modelRef, ...(models.alternatives ?? [])];
  let logReads = 0;
  let queryPending = false;
  let comparison: ReturnType<typeof prepareLocalModelComparison> | undefined;
  const journal: { kind: "host-log" | "local-model"; index: number }[] = [];

  const services = {
    serverLog: {
      async query(filter: Parameters<typeof queryLog>[0]) {
        if (queryPending || comparison !== undefined)
          throw new Error(
            "Read the assigned log windows in order before opening model inventory",
          );
        queryPending = true;
        try {
          const result = await queryLog(filter);
          journal.push({ kind: "host-log", index: logReads++ });
          return result;
        } finally {
          queryPending = false;
        }
      },
    },
    localModelTaskInventory: {
      async inspect(ref: string) {
        if (logReads !== windowCount || queryPending)
          throw new Error(
            "Complete the assigned host log review before opening model inventory",
          );
        if (!refs.includes(ref))
          throw new Error("Inspect only the assigned local model refs");
        comparison ??= prepareLocalModelComparison(
          extensions,
          contextId,
          modelWorld,
        );
        const result = await (
          await comparison
        ).services.localModelTaskInventory.inspect(ref);
        journal.push({ kind: "local-model", index: refs.indexOf(ref) });
        return result;
      },
    },
  };

  const workflowRequest = {
    goal,
    work: [
      {
        kind: "domain",
        domain: "localModel",
        operation: "prepareLocalModel",
        input: models,
      },
      {
        kind: "domain",
        domain: "system",
        operation: "investigateSystem",
        input: log.request,
      },
    ],
  };

  async function verify(
    report: {
      results?: {
        kind: string;
        domain?: string;
        operation?: string;
        report?: unknown;
      }[];
      remaining?: string[];
    } | null,
  ) {
    const result = report?.results;
    const logReport =
      (result?.[0]?.report as SystemInvestigationReport | null) ?? null;
    const modelReport = (result?.[1]?.report as LocalTaskReport | null) ?? null;
    const logVerification = log.verify(logReport);
    const prepared = await comparison;
    const modelVerification = prepared
      ? prepared.verify(modelReport, await prepared.readback())
      : null;
    const checks = {
      reportOrder:
        result?.length === 2 &&
        report?.remaining?.length === 0 &&
        result.every(({ kind }) => kind === "domain") &&
        result[0]?.domain === "system" &&
        result[0].operation === "investigateSystem" &&
        result[1]?.domain === "localModel" &&
        result[1].operation === "prepareLocalModel",
      readOrder:
        journal.length === windowCount + refs.length &&
        journal.every(({ kind, index }, position) =>
          position < windowCount
            ? kind === "host-log" && index === position
            : kind === "local-model" && index === position - windowCount,
        ),
      log: logVerification.passed,
      models: modelVerification?.passed === true,
    };
    return {
      log: { contextId, verification: logVerification },
      models: modelVerification
        ? { contextId, verification: modelVerification }
        : null,
      verification: {
        caseId,
        contextId,
        journal: [...journal],
        checks,
        passed: Object.values(checks).every(Boolean),
      },
    };
  }

  async function qualify() {
    let rejectedPrematureRead = false;
    try {
      await services.localModelTaskInventory.inspect(models.modelRef);
    } catch {
      rejectedPrematureRead = comparison === undefined;
    }
    for (const { sinceSeq, tag } of log.request.windows)
      await services.serverLog.query({ sinceSeq, tag, limit: 100 });
    for (const ref of refs) await services.localModelTaskInventory.inspect(ref);
    const reference = {
      remaining: [],
      results: [
        { ...workflowRequest.work[1]!, report: log.expected },
        { ...workflowRequest.work[0]!, report: (await comparison)?.expected },
      ],
    };
    const result = await verify(reference);
    return { verification: result.verification, rejectedPrematureRead };
  }

  return { workflowRequest, services, verify, qualify };
}
