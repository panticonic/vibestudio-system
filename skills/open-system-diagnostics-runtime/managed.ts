import {assessObservedApplicationOutcome} from "@workspace/application-outcomes/observed-application-outcome";
import type {InvocationObservations} from "@workspace/application-outcomes/observed-invocation";
import type {SemanticOutcomeContract} from "@workspace/application-outcomes/semantic-outcome-contract";
import { isDeepStrictEqual } from "node:util";
import { sha256HexSyncText } from "@vibestudio/content-addressing";
import { mainRpcMethods } from "@vibestudio/service-schemas/mainRpc";
import { contextId as runtimeContext, fs, rpc } from "@workspace/runtime";
import { bindServerLogCursor } from "@workspace-skills/server-log-cursor-bindings";
import type {
  DiagnosticArtifact, DiagnosticFinding, DiagnosticRecord, DiagnosticReport, DiagnosticSource,
  DiagnosticWindow, Disposition, ExactDiagnosticCitation, WindowStatus,
} from "../open-system-diagnostics/types.js";

type Checkpoint = Omit<DiagnosticSource, "id"> & {
  key: string; first: number; last: number; cursor?: "previous-boot" | "future"; limit?: number;
};
type World = {
  id: string;
  goal: string;
  lines: readonly string[];
  checkpoints: readonly Checkpoint[];
  mayStage: boolean;
  expected: {
    windows: Readonly<Record<string, WindowStatus>>;
    status: Disposition;
    citations: readonly [key: string, line: number][];
    stage: boolean;
    mentions?: readonly (readonly string[])[];
  };
};
type Seed = { marker: string; boot: string; workspaceId: string; start: number; steps: number[] };
type Source = { checkpoint: Checkpoint; source: DiagnosticSource };
type Envelope = DiagnosticReport;
const tag = "WorkerdManager";
const sequence = (record: DiagnosticRecord) => record.seq;
const format = (finding: DiagnosticFinding) => JSON.stringify({ schema: "vibestudio.diagnostic-handoff/1", finding }, null, 2) + "\n";
const dispositions: Disposition[] = ["ongoing", "recovered", "attention", "clear", "unconfirmed"];

export async function prepareOpenSystemDiagnostics(
  { contextId, caseId }: { contextId: string; caseId: string }, world: World, seed: Seed,
) {
  if (contextId !== runtimeContext || caseId !== world.id || seed.steps.length !== world.lines.length ||
      !seed.steps.every((seq, index) => seq > (seed.steps[index - 1] ?? seed.start)))
    throw new Error("Diagnostic checkpoints need live seed evidence in the owned context");
  if (new Set(world.checkpoints.map(({ key }) => key)).size !== world.checkpoints.length ||
      world.checkpoints.some(({ first, last }) => !Number.isInteger(first) || !Number.isInteger(last) ||
        first < 0 || last < first || last >= seed.steps.length))
    throw new Error("Invalid diagnostic checkpoint catalog");
  const sources: Source[] = world.checkpoints.map((checkpoint) => ({ checkpoint, source: {
    id: crypto.randomUUID(), label: checkpoint.label, component: checkpoint.component, description: checkpoint.description,
  } }));
  const catalog = { checkpoints: sources.map(({ source }) => source), mayStage: world.mayStage };
  const observed = new Map<string, DiagnosticWindow>();
  const reading = new Set<string>();
  let discovered = false;
  let staging = false;
  let savedHandoff: { receipt: DiagnosticArtifact; finding: DiagnosticFinding } | null = null;

  function sourceFor(key: string) {
    const entry = sources.find(({ checkpoint }) => checkpoint.key === key);
    if (!entry) throw new Error(`Unknown diagnostic checkpoint ${key}`);
    return entry;
  }
  function windowBounds(checkpoint: Checkpoint) {
    return {
      after: seed.steps[checkpoint.first - 1] ?? seed.start,
      through: seed.steps[checkpoint.last]!,
      limit: checkpoint.limit ?? 24,
    };
  }
  function project(records: readonly { seq: number; message: string }[]) {
    return records.map(({ seq, message }) => {
      const owned = `${seed.marker} `;
      const line = message.split(/\r?\n/u).find((part) => part.includes(owned));
      const text = line?.slice(line.indexOf(owned) + owned.length).trim();
      if (!text || text !== world.lines[seed.steps.indexOf(seq)])
        throw new Error("A native log observation does not match its owned capture record");
      return { seq, text };
    });
  }

  async function read({ checkpoint, source }: Source): Promise<DiagnosticWindow> {
    const { after, through, limit } = windowBounds(checkpoint);
    const saved = {
      serverBootId: checkpoint.cursor === "previous-boot" ? `retired-${source.id}` : seed.boot,
      seq: checkpoint.cursor === "future" ? Number.MAX_SAFE_INTEGER : after,
    };
    const bound = bindServerLogCursor({ goal: world.goal, saved, tag, contains: seed.marker, limit,
      ...(checkpoint.cursor === "future" ? {} : { throughSeq: through }) });
    const result = await bound.services.serverLogCursor.observe(bound.request.operationId);
    const status: WindowStatus = result.liveBoot !== saved.serverBootId ? "other-boot"
      : saved.seq > result.latestSeq ? "future"
      : result.oldestSeq !== null && saved.seq < result.oldestSeq - 1 ? "expired"
      : result.overflow ? "overflow"
      : result.snapshot ? "observed" : "changed";
    return {
      source, status, saved: { boot: saved.serverBootId, sequence: saved.seq }, liveBoot: result.liveBoot,
      through: status === "observed" || status === "overflow" ? result.throughSeq : null,
      records: status === "observed" && result.snapshot ? project(result.snapshot.records) : [],
    };
  }

  function exactCitation(citation: ExactDiagnosticCitation) {
    const window = observed.get(citation.sourceId);
    return window?.status === "observed" && window.liveBoot === citation.boot &&
      window.records.some(({ seq, text }) => seq === citation.seq && text === citation.text);
  }

  const services = {
    diagnosticCatalog: {
      async discover() {
        discovered = true;
        return structuredClone(catalog);
      },
    },
    diagnosticLog: {
      async read(sourceId: string) {
        const selected = sources.find(({ source }) => source.id === sourceId);
        if (!discovered || !selected || observed.has(sourceId) || reading.has(sourceId) || staging || savedHandoff)
          throw new Error("Read an authorized discovered checkpoint once before staging a handoff");
        reading.add(sourceId);
        try {
          const window = await read(selected);
          observed.set(sourceId, window);
          return structuredClone(window);
        } finally {
          reading.delete(sourceId);
        }
      },
    },
    diagnosticHandoff: {
      async stage(finding: DiagnosticFinding) {
        if (!world.mayStage || savedHandoff || staging || reading.size || !dispositions.includes(finding?.status) ||
            typeof finding.reason !== "string" || !finding.reason.trim() || finding.reason.length > 1200 ||
            !Array.isArray(finding.citations) || !finding.citations.length ||
            new Set(finding.citations.map(({ sourceId, seq }) => `${sourceId}:${seq}`)).size !== finding.citations.length ||
            !finding.citations.every(exactCitation))
          throw new Error("An authorized diagnostic handoff needs exact observed source evidence");
        staging = true;
        try {
          const directory = await fs.mkdtemp("system-diagnostic-handoff");
          const path = `${directory}/incident.json`;
          const text = format(finding);
          await fs.writeFile(path, text);
          if (await fs.readFile(path, "utf8") !== text) throw new Error("The incident handoff changed during writeback");
          const receipt = { path, sha256: sha256HexSyncText(text) };
          savedHandoff = { receipt, finding: structuredClone(finding) };
          return structuredClone(receipt);
        } finally {
          staging = false;
        }
      },
    },
  };

  function expectedCitations() {
    return world.expected.citations.map(([key, index]): ExactDiagnosticCitation => {
      const { checkpoint, source } = sourceFor(key);
      const seq = seed.steps[index], text = world.lines[index];
      if (seq === undefined || !text || index < checkpoint.first || index > checkpoint.last)
        throw new Error("Expected diagnostic citation is outside the captured interval");
      return { sourceId: source.id, boot: seed.boot, seq, text };
    });
  }

  async function verifyNative(checkpoint: Checkpoint, window: DiagnosticWindow) {
    const { after, through, limit } = windowBounds(checkpoint);
    const latest = await rpc.call("main", mainRpcMethods["serverLog.query"], [{ contains: seed.marker, limit: 1 }]);
    if (latest.serverBootId !== seed.boot || latest.workspaceId !== seed.workspaceId || window.liveBoot !== seed.boot) return false;
    if (window.status === "other-boot") return window.saved.boot !== latest.serverBootId && window.records.length === 0;
    if (window.status === "future") return window.saved.sequence > latest.latestSeq && window.records.length === 0;
    if (window.status !== "observed" && window.status !== "overflow") return false;
    const native = await rpc.call("main", mainRpcMethods["serverLog.query"], [{
      sinceSeq: after, untilSeq: through, tag, contains: seed.marker, limit: limit + 1,
    }]);
    if (native.serverBootId !== seed.boot || native.workspaceId !== seed.workspaceId || window.through !== through ||
        window.saved.sequence !== after || window.saved.boot !== seed.boot) return false;
    const records = project(native.records);
    if (window.status === "overflow") return records.length > limit && window.records.length === 0;
    return isDeepStrictEqual(records, window.records) &&
      isDeepStrictEqual(records.map(sequence), seed.steps.slice(checkpoint.first, checkpoint.last + 1));
  }

  function coverage() {
    return [...observed.values()].map(({ source, status, liveBoot, through }) => ({ sourceId: source.id, status, liveBoot, through }));
  }
  async function verifyEvidence(value: unknown, boundary?: { rejectedForeign: boolean; rejectedForged: boolean },invocation?:InvocationObservations) {
    const envelope = value as Partial<Envelope> | null;
    const report = envelope?.outcome ?? value as DiagnosticReport | null;
    const native = await Promise.all(sources.filter(({ source }) => observed.has(source.id))
      .map(({ checkpoint, source }) => verifyNative(checkpoint, observed.get(source.id)!)));
    const expected = world.expected;
    const expectedReads = Object.entries(expected.windows);
    const reason = typeof report?.finding?.reason === "string" ? report.finding.reason.toLowerCase() : null;
    const citations = report?.finding?.citations;
    const ordered = (values: readonly ExactDiagnosticCitation[]) => [...values].sort((left, right) => left.seq - right.seq || left.sourceId.localeCompare(right.sourceId));
    const handoffReadback = savedHandoff ? await fs.readFile(savedHandoff.receipt.path, "utf8") : null;
    const verifiedHandoff = !expected.stage
      ? savedHandoff === null
      : Boolean(savedHandoff &&
          handoffReadback === format(savedHandoff.finding) &&
          savedHandoff.receipt.sha256 === sha256HexSyncText(format(savedHandoff.finding)));
    const checks = {
      returnedDiagnosticArtifact:isDeepStrictEqual(report?.artifact,savedHandoff?.receipt??null),
      discoveredDiagnosticCheckpoints: discovered,
      boundNativeDiagnosticReadback: native.every(Boolean),
      selectedRequiredDiagnosticWindows: expectedReads.every(([key, status]) => observed.get(sourceFor(key).source.id)?.status === status),
      preservedDiagnosticBootCoverage: Array.isArray(report?.coverage) && isDeepStrictEqual(
        [...report.coverage].sort((a, b) => a.sourceId.localeCompare(b.sourceId)), coverage().sort((a, b) => a.sourceId.localeCompare(b.sourceId))),
      reconciledDiagnosticFinding: report?.finding?.status === expected.status && Boolean(reason && (expected.mentions ?? []).every((choices) => choices.some((term) => reason.includes(term)))),
      groundedDiagnosticCitations: Array.isArray(citations) && citations.every(exactCitation) &&
        isDeepStrictEqual(ordered(citations), ordered(expectedCitations())),
      verifiedDiagnosticHandoff: verifiedHandoff,
      ...(boundary && "rejectedForeign" in boundary ? { rejectedForeignDiagnosticCheckpoint: boundary.rejectedForeign, rejectedForgedDiagnosticCitation: boundary.rejectedForged } : {}),
    };
    const contract:SemanticOutcomeContract={effects:{checks:["discoveredDiagnosticCheckpoints", "boundNativeDiagnosticReadback", "selectedRequiredDiagnosticWindows", "verifiedDiagnosticHandoff"] .concat(boundary && "rejectedForeign" in boundary ? ["rejectedForeignDiagnosticCheckpoint","rejectedForgedDiagnosticCitation"] : []),rationale:"Independent native observations, authority and persisted state establish application effects."},returnedValue:{checks:["preservedDiagnosticBootCoverage", "reconciledDiagnosticFinding", "groundedDiagnosticCitations"],required:true,rationale:"These are the actual requested domain findings or query values; mutation-only calls retain their separately observed effects."},incidentalValues:{checks:["returnedDiagnosticArtifact"],rationale:"Optional incorrect mutation returns are recorded against the actual invocation, without invalidating correct native effects."}};

    const assessed=await assessObservedApplicationOutcome({
      caseId, contextId, goal: world.goal, catalog, windows: [...observed.values()],
      handoff: savedHandoff?.receipt ?? null, handoffReadback,
      checks, passed: Object.values(checks).every(Boolean),
    },contract,value,invocation,[]);
    const {observedChecks,...dimensions}=assessed;
    return {...dimensions,checks:observedChecks};
  }

  async function verify(value:unknown,invocation?:InvocationObservations){return verifyEvidence(value,undefined,invocation);}
  return {
    goal: world.goal, services, verify,
    async qualify() {
      await services.diagnosticCatalog.discover();
      let rejectedForeign = false;
      try { await services.diagnosticLog.read(crypto.randomUUID()); }
      catch { rejectedForeign = true; }
      for (const key of Object.keys(world.expected.windows)) await services.diagnosticLog.read(sourceFor(key).source.id);
      let rejectedForged = false;
      try {
        await services.diagnosticHandoff.stage({ status: "clear", reason: "Foreign record", citations: [{
          sourceId: crypto.randomUUID(), boot: seed.boot, seq: seed.steps[0]!, text: "Different incident",
        }] });
      } catch { rejectedForged = true; }
      const finding = { status: world.expected.status, reason: (world.expected.mentions ?? []).map(([term]) => term).join("; ") || "Owned diagnostic interval verified", citations: expectedCitations() };
      const artifact = world.expected.stage ? await services.diagnosticHandoff.stage(finding) : null;
      const report: Envelope = { finding, coverage: coverage(), artifact };
      return verifyEvidence(report, { rejectedForeign, rejectedForged });
    },
  };
}
