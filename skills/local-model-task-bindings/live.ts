import {isDeepStrictEqual} from "node:util";
import type {
  LocalTaskCandidate,
  LocalTaskInventoryRow,
  LocalTaskReport,
  LocalTaskRequest,
} from "../local-model-task/types.js";
import { inventoryRow } from "./bind.js";
import {
  readLocalModelInventory,
  type LocalTaskExtensionPort,
} from "./index.js";

interface LocalModelWorld {
  id: string;
  request: LocalTaskRequest;
}

function referenceCandidate(
  request: LocalTaskRequest,
  ref: string,
  row: LocalTaskInventoryRow | null,
): LocalTaskCandidate {
  const observation = { ref, state: row?.state ?? null, handoff: null };
  if (!row) return { ...observation, disposition: "unavailable" };
  switch (row.state) {
    case "not-installed":
      return {
        ...observation,
        disposition: row.fit === "too-big" ? "too-big" : "needs-install",
      };
    case "downloading":
    case "starting":
      return { ...observation, disposition: "wait-for-progress" };
    case "error":
      return { ...observation, disposition: "catalog-error" };
    case "ready":
    case "startable":
      if (request.needsTools && !row.toolsCapable)
        return { ...observation, disposition: "unsupported-tools" };
      if (row.contextWindow < request.minimumContext)
        return { ...observation, disposition: "context-too-small" };
      return {
        ...observation,
        disposition: "ready-to-delegate",
        handoff: {
          ref,
          mode: request.requiresPriorConversation ? "fork" : "fresh",
        },
      };
  }
}

function sameHandoff(
  observed: LocalTaskCandidate["handoff"] | undefined,
  expected: LocalTaskCandidate["handoff"],
) {
  return expected === null
    ? observed === null
    : observed?.ref === expected.ref && observed.mode === expected.mode;
}

export async function prepareLocalModelComparison(
  extensions: LocalTaskExtensionPort,
  contextId: string,
  world: LocalModelWorld,
) {
  const request = structuredClone(world.request);
  const refs = [request.modelRef, ...(request.alternatives ?? [])];
  if (
    request.operation !== "compare" ||
    request.mayInstall ||
    refs.length < 2 ||
    refs.some((ref) => !/^local:[^:/\s]+$/u.test(ref)) ||
    new Set(refs).size !== refs.length
  )
    throw new Error(
      "Expected a read-only comparison of distinct local model refs.",
    );

  async function readback() {
    const snapshot = await readLocalModelInventory(extensions);
    return refs.map((ref) => {
      const row = inventoryRow(snapshot, ref);
      return { ref, row: row === null ? null : { ...row, errorMessage: null } };
    });
  }
  const initialRows = await readback();
  const observed=new Map(initialRows.map(({ref,row})=>[ref,row]));
  const inspected: string[] = [];
  const observations:typeof initialRows=[];
  function expectedReport(rows:typeof initialRows) {
    const candidates = rows.map(({ ref, row }) =>
      referenceCandidate(request, ref, row),
    );
    const selected = candidates.find(({ handoff }) => handoff !== null);
    const expected: LocalTaskReport = {
      disposition: selected?.disposition ?? "no-candidate",
      ref: selected?.ref ?? request.modelRef,
      state: selected?.state ?? null,
      receipt: null,
      handoff: selected?.handoff ?? null,
      candidates,
    };

    return {expected,candidates};
  }

  function verify(report: LocalTaskReport | null, after: typeof initialRows) {
    const {expected,candidates}=expectedReport(after);
    const checks = {
      currentInventory: after.length===refs.length && refs.every(ref=>
        after.filter(row=>row.ref===ref).length===1 && inspected.includes(ref) &&
        isDeepStrictEqual(after.find(row=>row.ref===ref)!.row,observed.get(ref))),
      exactReads:
        refs.every(ref => inspected.includes(ref)),
      handoff:
        report?.disposition === expected.disposition &&
        report.ref === expected.ref &&
        report.state === expected.state &&
        sameHandoff(report.handoff, expected.handoff) &&
        report.receipt === null,
      candidates:
        Array.isArray(report?.candidates) &&
        report.candidates.length === candidates.length &&
        candidates.every((candidate) => {
          const result = report.candidates?.find(row => row.ref === candidate.ref);
          return (
            result?.ref === candidate.ref &&
            result.state === candidate.state &&
            result.disposition === candidate.disposition &&
            sameHandoff(result.handoff, candidate.handoff)
          );
        }),
    };
    return {
      contextId,
      caseId: world.id,
      rows:structuredClone(after),
      initialRows:structuredClone(initialRows),
      inspected:[...inspected],
      observations:structuredClone(observations),
      expected,
      checks,
      passed: Object.values(checks).every(Boolean),
    };
  }

  return {
    request,
    get expected(){return expectedReport(refs.map(ref=>({ref,row:observed.get(ref)!}))).expected;},
    verify,
    readback,
    services: {
      localModelTaskInventory: {
        async inspect(ref: string) {
          if (!refs.includes(ref))
            throw new Error("Inspect only the assigned local candidates");
          const latest=await readback();
          const row=latest.find(row=>row.ref===ref)!.row;
          observed.set(ref,row);
          inspected.push(ref);
          observations.push({ref,row:structuredClone(row)});
          return structuredClone(row);
        },
      },
    },
  };
}
