import { isDeepStrictEqual } from "node:util";
import { vcs } from "@workspace/runtime";
import type { HostKind } from "@vibestudio/workspace-contracts/clients";
import type {
  ClientAdmissionObservation,
  ClientAdmissionReview,
} from "./natlang/types.js";
import { bindClientAdmission } from "./workflow.js";

type Assignment = {
  id: string;
  source: string;
  host: HostKind;
  goal: string;
  runtime: string;
  publishedAbi: string;
  workingAbi: string;
  abi: ClientAdmissionReview["host"]["abi"];
};

const catalogDecisions = {
  ready: "reviewed-ready",
  "approval-required": "await-approval",
  building: "await-build",
  available: "await-build",
  error: "inspect-build",
} as const;

export async function prepareManagedClientAdmission(
  contextId: string,
  world: Assignment,
) {
  const initial = await vcs.status({ contextId });
  if (world.workingAbi !== world.publishedAbi) {
    const state = initial.workingHead;
    const repo = await vcs.resolveRepository({ state, repoPath: world.source });
    if (!repo) throw new Error("Missing assigned client");
    const file = await vcs.readFile({
      state,
      repositoryId: repo.repositoryId,
      file: { kind: "path", path: "package.json" },
    });
    if (file?.content.kind !== "text")
      throw new Error("Missing assigned client manifest");
    const manifest = JSON.parse(file.content.text);
    if (manifest.vibestudio?.client?.hostAbi !== world.publishedAbi)
      throw new Error("The assigned client ABI has changed");
    manifest.vibestudio.client.hostAbi = world.workingAbi;
    await vcs.edit({
      contextId,
      expectedWorkingHead: state,
      commandId: `client-admission-${crypto.randomUUID()}`,
      intentSummary: "Stage an incompatible client ABI for review",
      changes: [
        {
          kind: "content-replace",
          repositoryId: repo.repositoryId,
          fileId: file.fileId,
          content: {
            kind: "text",
            text: JSON.stringify(manifest, null, 2) + "\n",
          },
        },
      ],
    });
  }
  const assigned = await vcs.status({ contextId });
  const assignedRevision =
    assigned.workingHead.kind === "event"
      ? assigned.workingHead.eventId
      : assigned.workingHead.applicationId;
  const bound = bindClientAdmission({ contextId, ...world });
  const observations: ClientAdmissionObservation[] = [];
  const services = {
    clientAdmissionRead: {
      async observe(operationId: string) {
        const observation =
          await bound.services.clientAdmissionRead.observe(operationId);
        observations.push(structuredClone(observation));
        return observation;
      },
    },
  };

  function expected(
    observation: ClientAdmissionObservation,
  ): ClientAdmissionReview {
    const { working, host, trusted, catalog } = observation;
    const untrusted = (capability: string) =>
      !trusted && host.deviceLevel.includes(capability);
    const capabilities = {
      missingRequired: working.required.filter(
        (capability) => !host.capabilities.includes(capability),
      ),
      untrustedRequired: working.required.filter(untrusted),
      deniedOptional: working.optional.filter(
        (capability) =>
          !host.capabilities.includes(capability) || untrusted(capability),
      ),
    };
    const disposition =
      world.workingAbi === world.publishedAbi
        ? "published-contract"
        : "working-change";
    return {
      source: { observation, disposition },
      host: { abi: world.abi, capabilities },
      decision:
        world.abi === "wrong-runtime"
          ? "match-runtime"
          : world.abi === "wrong-abi"
            ? "resolve-abi"
            : capabilities.missingRequired.length ||
                capabilities.untrustedRequired.length
              ? "resolve-required-capabilities"
              : disposition === "working-change"
                ? "review-candidate"
                : catalog
                  ? catalogDecisions[catalog.status]
                  : "check-declaration",
    };
  }

  async function verify(report: ClientAdmissionReview | null) {
    const [observation] = observations;
    const after = await vcs.status({ contextId });
    const changed = world.workingAbi !== world.publishedAbi;
    const checks = {
      source:
        observations.length === 1 &&
        observation?.operationId === bound.request.operationId &&
        observation.contextId === contextId &&
        observation.source === world.source &&
        observation.mainRevision === initial.mainEventId &&
        observation.workingRevision === assignedRevision &&
        observation.working.runtime === world.runtime &&
        observation.published.runtime === world.runtime &&
        observation.working.abi === world.workingAbi &&
        observation.published.abi === world.publishedAbi &&
        (changed
          ? observation.working.hash !== observation.published.hash &&
            !assigned.clean
          : observation.working.hash === observation.published.hash),
      host:
        observation?.host.kind === world.host &&
        observation.trusted &&
        (observation.host.runtimes[world.runtime]
          ? observation.host.runtimes[world.runtime] === world.workingAbi
            ? "compatible"
            : "wrong-abi"
          : "wrong-runtime") === world.abi,
      catalog: observation?.catalog?.source === world.source,
      unchanged:
        after.mainEventId === initial.mainEventId &&
        isDeepStrictEqual(after.workingHead, assigned.workingHead),
      report: Boolean(
        observation && isDeepStrictEqual(report, expected(observation)),
      ),
    };
    return {
      passed: Object.values(checks).every(Boolean),
      contextId,
      caseId: world.id,
      request: bound.request,
      observation,
      checks,
    };
  }

  async function qualify() {
    let rejectedForeignScope = false;
    try {
      await services.clientAdmissionRead.observe("foreign");
    } catch (error) {
      rejectedForeignScope =
        error instanceof Error && /assigned System client/.test(error.message);
    }
    const report = expected(
      await services.clientAdmissionRead.observe(bound.request.operationId),
    );
    return {
      verification: await verify(report),
      rejectedForeignScope,
      rejectedWrongDecision: !(
        await verify({
          ...report,
          decision:
            report.decision === "reviewed-ready"
              ? "resolve-abi"
              : "reviewed-ready",
        })
      ).passed,
    };
  }
  return { request: bound.request, services, verify, qualify };
}
