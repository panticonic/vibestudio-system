import type {
  LocalTaskInventoryRow,
  LocalTaskReport,
  LocalTaskRequest,
} from "../local-model-task/types.js";
import type { LocalTaskFixtureOperation } from "./fixture.js";

type Snapshot = Pick<LocalTaskInventoryRow, "state"> &
  Partial<
    Pick<LocalTaskInventoryRow, "fit" | "toolsCapable" | "contextWindow">
  >;
export type LocalTaskWorld = {
  id: string;
  sourceGroup: string;
  request: LocalTaskRequest;
  snapshots: (Snapshot | null)[];
  authorizedInstall: boolean;
  installation?: "complete" | "existing" | "reject" | "wrong-model";
  expectedOperations: readonly LocalTaskFixtureOperation[];
  expected: LocalTaskReport;
};

type Options = {
  operation?: LocalTaskRequest["operation"];
  mayInstall?: boolean;
  authorizedInstall?: boolean;
  needsTools?: boolean;
  minimumContext?: number;
  fork?: boolean;
  installation?: LocalTaskWorld["installation"];
  receipt?: "installed" | "validated-existing" | "state-changed";
  handoff?: "fresh" | "fork";
};
const old = { state: "not-installed" } as const;
const ready = { state: "ready" } as const;
const startable = { state: "startable" } as const;
const downloading = { state: "downloading" } as const;
const starting = { state: "starting" } as const;
const failed = { state: "error" } as const;

function task(
  slug: string,
  goal: string,
  snapshots: LocalTaskWorld["snapshots"],
  disposition: LocalTaskReport["disposition"],
  finalState: LocalTaskReport["state"],
  opts: Options = {},
): LocalTaskWorld {
  const modelRef = "local:" + slug;
  const authorizedInstall = opts.authorizedInstall ?? opts.mayInstall ?? false;
  const expectedOperations: LocalTaskFixtureOperation[] = ["listModels"];
  if (opts.receipt || opts.installation) {
    if (authorizedInstall) expectedOperations.push("listModels");
    if (opts.installation && authorizedInstall)
      expectedOperations.push("installModel");
    if (opts.receipt) expectedOperations.push("listModels");
  }
  return {
    id: "local-model-task-" + slug,
    sourceGroup: "vibestudio:local-model-task:" + slug,
    request: {
      goal,
      modelRef,
      operation: opts.operation ?? "inspect",
      mayInstall: opts.mayInstall ?? false,
      needsTools: opts.needsTools ?? false,
      minimumContext: opts.minimumContext ?? 0,
      requiresPriorConversation: opts.fork ?? false,
    },
    snapshots,
    authorizedInstall,
    ...(opts.installation ? { installation: opts.installation } : {}),
    expectedOperations,
    expected: {
      disposition,
      ref: modelRef,
      state: finalState,
      receipt: opts.receipt
        ? opts.receipt === "installed"
          ? { kind: "installed", ref: modelRef, jobId: "install-" + slug }
          : { kind: opts.receipt, ref: modelRef }
        : null,
      handoff: opts.handoff ? { ref: modelRef, mode: opts.handoff } : null,
    },
  };
}

export const localModelTaskWorlds: LocalTaskWorld[] = [
  task(
    "cedar-check",
    "Check whether the running model can be used on this workspace.",
    [ready],
    "usable",
    "ready",
  ),
  task(
    "birch-cold",
    "Inspect a downloaded model with no current server.",
    [startable],
    "usable",
    "startable",
  ),
  task(
    "elm-missing",
    "Tell me whether the selected model is present. Leave the machine alone.",
    [old],
    "needs-install",
    "not-installed",
  ),
  task(
    "fir-missing-offer",
    "Inspect the model's state after I separately enabled install permission in the tool.",
    [old],
    "needs-install",
    "not-installed",
    { mayInstall: true },
  ),
  task(
    "larch-unoffered",
    "Can I use this ref even though it disappeared from the catalog?",
    [null],
    "unavailable",
    null,
    { operation: "prepare", mayInstall: true },
  ),
  task(
    "ash-unfit",
    "Prepare this huge model only if our current machine can fit it.",
    [{ ...old, fit: "too-big" }],
    "too-big",
    "not-installed",
    { operation: "prepare", mayInstall: true },
  ),
  task(
    "beech-pending",
    "A separate client already started the download. Can my job use it now?",
    [downloading],
    "wait-for-progress",
    "downloading",
    { operation: "delegate", mayInstall: true },
  ),
  task(
    "hazel-loading",
    "Check the runner while its server still starts.",
    [starting],
    "wait-for-progress",
    "starting",
    { operation: "delegate" },
  ),
  task(
    "linden-error",
    "Check whether failed validation leaves us able to delegate.",
    [failed],
    "catalog-error",
    "error",
    { operation: "delegate", mayInstall: true },
  ),
  task(
    "spruce-needs-confirmation",
    "Prepare this model if present. I haven't authorized a persistent download.",
    [old],
    "needs-install-confirmation",
    "not-installed",
    { operation: "prepare" },
  ),
  task(
    "willow-fresh",
    "Use the selected ready model for a self-contained bounded task.",
    [ready],
    "ready-to-delegate",
    "ready",
    { operation: "delegate", handoff: "fresh" },
  ),
  task(
    "alder-fork",
    "Continue my existing multi-turn discussion on the selected local model.",
    [startable],
    "ready-to-delegate",
    "startable",
    { operation: "delegate", fork: true, handoff: "fork" },
  ),
  task(
    "maple-tool-less",
    "Can this model perform a task that requires workspace tools?",
    [{ ...ready, toolsCapable: false }],
    "unsupported-tools",
    "ready",
    { operation: "delegate", needsTools: true },
  ),
  task(
    "poplar-narrow",
    "Can this downloaded model fit a thirteen-thousand-token task?",
    [{ ...startable, contextWindow: 8192 }],
    "context-too-small",
    "startable",
    { operation: "delegate", minimumContext: 13000 },
  ),
  task(
    "pine-exact-context",
    "Prepare a task requiring exactly the model's observed context capacity.",
    [{ ...startable, contextWindow: 4096 }],
    "ready-to-delegate",
    "startable",
    { operation: "delegate", minimumContext: 4096, handoff: "fresh" },
  ),
  task(
    "cypress-download",
    "Install this missing model and verify its reported availability.",
    [old, old, startable],
    "usable",
    "startable",
    {
      operation: "prepare",
      mayInstall: true,
      installation: "complete",
      receipt: "installed",
    },
  ),
  task(
    "hemlock-install-delegate",
    "Install this model if missing, then prepare an independent tool-using child.",
    [old, old, ready],
    "ready-to-delegate",
    "ready",
    {
      operation: "delegate",
      needsTools: true,
      mayInstall: true,
      installation: "complete",
      receipt: "installed",
      handoff: "fresh",
    },
  ),
  task(
    "hickory-cached",
    "The runtime found a cached copy during installation. Verify readiness using the inventory.",
    [old, old, startable],
    "usable",
    "startable",
    {
      operation: "prepare",
      mayInstall: true,
      installation: "existing",
      receipt: "validated-existing",
    },
  ),
  task(
    "juniper-missing-readback",
    "A reported install job finished, but the fresh inventory has no assigned row.",
    [old, old, null],
    "installation-unverified",
    null,
    {
      operation: "prepare",
      mayInstall: true,
      installation: "complete",
      receipt: "installed",
    },
  ),
  task(
    "walnut-validation-lost",
    "The artifact step reported success but the current catalog says runtime validation failed.",
    [old, old, failed],
    "catalog-error",
    "error",
    {
      operation: "delegate",
      mayInstall: true,
      installation: "complete",
      receipt: "installed",
    },
  ),
  task(
    "oak-still-receiving",
    "A newer transfer appears after completion. Check whether the selected model can actually serve.",
    [old, old, downloading],
    "wait-for-progress",
    "downloading",
    {
      operation: "delegate",
      mayInstall: true,
      installation: "complete",
      receipt: "installed",
    },
  ),
  task(
    "mahogany-concurrent-start",
    "Another client began installation between inspection and the guarded action.",
    [old, downloading, downloading],
    "wait-for-progress",
    "downloading",
    { operation: "prepare", mayInstall: true, receipt: "state-changed" },
  ),
  task(
    "redwood-concurrent-ready",
    "A coworker installed it first. Prepare the handoff from current evidence.",
    [old, startable, startable],
    "ready-to-delegate",
    "startable",
    {
      operation: "delegate",
      mayInstall: true,
      receipt: "state-changed",
      handoff: "fresh",
    },
  ),
  task(
    "mimosa-concurrent-removed",
    "The model is withdrawn before the installation request can run.",
    [old, null, null],
    "installation-unverified",
    null,
    { operation: "prepare", mayInstall: true, receipt: "state-changed" },
  ),
  task(
    "magnolia-denied",
    "The authorized install was refused by its owning extension.",
    [old, old],
    "installation-rejected",
    "not-installed",
    { operation: "prepare", mayInstall: true, installation: "reject" },
  ),
  task(
    "calabash-receipt-mismatch",
    "The job response belongs to another model. Guard the selected handoff.",
    [old, old],
    "installation-rejected",
    "not-installed",
    { operation: "delegate", mayInstall: true, installation: "wrong-model" },
  ),
  task(
    "sequoia-closed-authority",
    "The request says install but the caller did not grant the effect in this context.",
    [old],
    "installation-rejected",
    "not-installed",
    {
      operation: "prepare",
      mayInstall: true,
      authorizedInstall: false,
      installation: "reject",
    },
  ),
  task(
    "chestnut-install-no-tools",
    "The model installed successfully. Check whether that proves it can use tool calls.",
    [old, old, { ...startable, toolsCapable: false }],
    "unsupported-tools",
    "startable",
    {
      operation: "delegate",
      mayInstall: true,
      needsTools: true,
      installation: "complete",
      receipt: "installed",
    },
  ),
];
