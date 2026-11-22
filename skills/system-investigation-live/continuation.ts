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
  const models = modelWorld.request;
  const refs = [models.modelRef, ...(models.alternatives ?? [])];
  let comparison: ReturnType<typeof prepareLocalModelComparison> | undefined;
  const journal: { kind: "host-log" | "local-model"; index: number }[] = [];

  const services = {
    serverLog: {
      async query(filter: Parameters<typeof queryLog>[0]) {
        const result = await queryLog(filter);
        journal.push({ kind: "host-log", index: log.request.windows.findIndex(window =>
          window.sinceSeq === filter.sinceSeq && window.tag === filter.tag) });
        return result;
      },
    },
    localModelTaskInventory: {
      async inspect(ref: string) {
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
      (result?.find(row => row.kind === "domain" && row.domain === "system" && row.operation === "investigateSystem")?.report as SystemInvestigationReport | null) ?? null;
    const modelReport = (result?.find(row => row.kind === "domain" && row.domain === "localModel" && row.operation === "prepareLocalModel")?.report as LocalTaskReport | null) ?? null;
    const logVerification = log.verify(logReport);
    const prepared = await comparison;
    const modelVerification = prepared
      ? prepared.verify(modelReport, await prepared.readback())
      : null;
    const checks = {
      requestedResults: report?.remaining?.length === 0 && Boolean(logReport && modelReport),
      evidenceCoverage: logVerification.checks.coveredWindows && refs.every((_, index) =>
        journal.some(row => row.kind === "local-model" && row.index === index)),
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
    let rejectedForeignRef = false;
    try {
      await services.localModelTaskInventory.inspect("unassigned-model-ref");
    } catch {
      rejectedForeignRef = comparison === undefined;
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
    return { verification: result.verification, rejectedForeignRef };
  }

  return { workflowRequest, services, verify, qualify };
}
