import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { RemoteCommissionWorld } from "./worlds.js";

const deploymentStages = ["baseline", "install", "verify"] as const;
const accessStages = ["profile", "pair", "route", "child"] as const;

/** Own one deployment and one device assignment, with an independent outcome check. */
export function createRemoteCommissionFixture(world: RemoteCommissionWorld) {
  const operationId = world.request.work[0]!.input.operationId;
  const attempt = randomUUID();
  const deviceId =
    world.operation === "commissionRemoteWorkspace"
      ? attempt + ":device"
      : operationId;
  const receipt = (stage: string) => attempt + ":" + stage;
  const steps: string[] = [];

  function advance(
    stage: string,
    supplied: string,
    expected: string,
    admitted: boolean,
  ) {
    if (!admitted || steps.includes(stage) || supplied !== expected)
      throw new Error(
        "Use the current receipt for the assigned remote operation",
      );
    steps.push(stage);
  }

  const { deployment, profile, identity } = world;
  const canInstall =
    (deployment?.state === "inactive" && deployment.intent === "deploy") ||
    (deployment?.intent === "update" &&
      deployment.state !== "unverified" &&
      deployment.hasPriorIdentity);
  const canReuse =
    deployment?.intent === "deploy" && deployment.state === "ready";
  const paired = () => steps.includes("pair") && profile?.pair === "paired";
  const canRoute = () =>
    paired() || profile?.state === "workspace" || profile?.state === "account";

  const bindings = {
    remoteDeploymentRead: {
      async observe(id: string) {
        advance("baseline", id, operationId, !!deployment);
        return {
          receipt: receipt("baseline"),
          state: deployment!.state,
          intent: deployment!.intent,
          hasPriorIdentity: deployment!.hasPriorIdentity,
        };
      },
    },
    remoteDeploymentApply: {
      async apply(id: string) {
        advance(
          "install",
          id,
          receipt("baseline"),
          steps.includes("baseline") && !!canInstall,
        );
        if (!deployment?.install) throw new Error("Installer outcome missing");
        return { receipt: receipt("install"), state: deployment.install };
      },
    },
    remoteDeploymentVerify: {
      async verify(id: string) {
        advance(
          "verify",
          id,
          receipt("install"),
          steps.includes("install") && deployment?.install === "applied",
        );
        if (!deployment?.verify)
          throw new Error("Verification outcome missing");
        return {
          receipt: receipt("verify"),
          state: deployment.verify,
          identity:
            deployment.verify === "verified" ? structuredClone(identity) : null,
        };
      },
    },
    remoteDeploymentHandoff: {
      async open(id: string) {
        const reuse = canReuse && steps.includes("baseline");
        const verified =
          steps.includes("verify") && deployment?.verify === "verified";
        advance(
          "handoff",
          id,
          receipt(reuse ? "baseline" : "verify"),
          world.operation === "commissionRemoteWorkspace" &&
            !!(reuse || verified),
        );
        if (!deployment?.handoff) throw new Error("Handoff state missing");
        return {
          state: deployment.handoff,
          operationId: deployment.handoff === "assigned" ? deviceId : null,
        };
      },
    },
    remoteAccessRead: {
      async observe(id: string) {
        const opened =
          steps.includes("handoff") && deployment?.handoff === "assigned";
        advance(
          "profile",
          id,
          deviceId,
          !!profile && (world.operation === "openRemoteWorkspace" || opened),
        );
        return {
          receipt: receipt("profile"),
          state: profile!.state,
          inviteAssigned: profile!.inviteAssigned,
        };
      },
    },
    remoteAccessPair: {
      async pair(id: string) {
        advance(
          "pair",
          id,
          receipt("profile"),
          steps.includes("profile") &&
            profile?.state === "unpaired" &&
            profile.inviteAssigned,
        );
        if (!profile?.pair) throw new Error("Pairing outcome missing");
        return { receipt: receipt("pair"), state: profile.pair };
      },
    },
    remoteAccessRoute: {
      async select(id: string) {
        advance(
          "route",
          id,
          receipt(paired() ? "pair" : "profile"),
          steps.includes("profile") && canRoute(),
        );
        if (!profile?.route) throw new Error("Routing outcome missing");
        return { receipt: receipt("route"), state: profile.route };
      },
    },
    remoteAccessVerify: {
      async verify(id: string) {
        advance(
          "child",
          id,
          receipt("route"),
          steps.includes("route") && profile?.route === "routed",
        );
        if (!profile?.child) throw new Error("Child outcome missing");
        return {
          receipt: receipt("child"),
          state: profile.child,
          workspaceId:
            profile.child === "verified" ? identity.workspaceId : null,
        };
      },
    },
  };
  function verify(report: unknown): boolean {
    const { outcome } = world;
    const evidenceIds = (allowed: readonly string[]) =>
      world.steps.filter((step) => allowed.includes(step)).map(receipt);
    const deployment = outcome.deployment
      ? {
          status: outcome.deployment,
          identity: outcome.deployment === "deployment-ready" ? identity : null,
          evidenceIds: evidenceIds(deploymentStages),
        }
      : null;
    const access = outcome.access
      ? {
          status: outcome.access,
          workspaceId:
            outcome.access === "workspace-ready" ? identity.workspaceId : null,
          evidenceIds: evidenceIds(accessStages),
        }
      : null;
    const handoff = outcome.handoff
      ? {
          state: outcome.handoff,
          operationId: outcome.handoff === "assigned" ? deviceId : null,
        }
      : null;
    const expected =
      world.operation === "commissionRemoteWorkspace"
        ? { deployment, handoff, access }
        : world.operation === "deployRemoteServer"
          ? deployment
          : access;
    return (
      isDeepStrictEqual(steps, world.steps) &&
      isDeepStrictEqual(report, expected)
    );
  }
  return { bindings, verify };
}
