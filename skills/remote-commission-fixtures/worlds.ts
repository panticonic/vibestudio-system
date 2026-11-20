import { createHash } from "node:crypto";
import type {
  DeploymentAction,
  DeploymentBaseline,
  DeploymentVerification,
  RemoteAccessDisposition,
  RemoteChildReceipt,
  RemoteCommissionReport,
  RemoteDeploymentStatus,
  RemotePairReceipt,
  RemoteProfileRead,
  RemoteRouteReceipt,
} from "../remote-access/types.js";

type Operation =
  | "commissionRemoteWorkspace"
  | "deployRemoteServer"
  | "openRemoteWorkspace";
type Stage =
  | "baseline"
  | "install"
  | "verify"
  | "handoff"
  | "profile"
  | "pair"
  | "route"
  | "child";
type Deployment = Pick<
  DeploymentBaseline,
  "state" | "intent" | "hasPriorIdentity"
> & {
  install?: DeploymentAction["state"];
  verify?: DeploymentVerification["state"];
  handoff?: NonNullable<RemoteCommissionReport["handoff"]>["state"];
};
type Profile = Pick<RemoteProfileRead, "state" | "inviteAssigned"> & {
  pair?: RemotePairReceipt["state"];
  route?: RemoteRouteReceipt["state"];
  child?: RemoteChildReceipt["state"];
};
type Assignment = {
  id: string;
  goal: string;
  operation: Operation;
  deployment?: Deployment;
  profile?: Profile;
  outcome: {
    deployment?: RemoteDeploymentStatus;
    access?: RemoteAccessDisposition;
    handoff?: "assigned" | "deployment-changed";
  };
  steps: Stage[];
};

const fresh: Deployment = {
  intent: "deploy",
  state: "inactive",
  hasPriorIdentity: false,
};
const installed: Deployment = {
  ...fresh,
  install: "applied",
  verify: "verified",
};
const running: Deployment = {
  intent: "deploy",
  state: "ready",
  hasPriorIdentity: true,
};
const activeUpdate: Deployment = { ...running, intent: "update" };
const resume: Profile = {
  state: "workspace",
  inviteAssigned: false,
  route: "routed",
  child: "verified",
};
const pair: Profile = {
  ...resume,
  state: "unpaired",
  inviteAssigned: true,
  pair: "paired",
};

const assignments: Assignment[] = [
  {
    id: "fresh-install-and-pair",
    goal: "Bring up the new project hub and open its workspace on the assigned CLI device.",
    operation: "commissionRemoteWorkspace",
    deployment: { ...installed, handoff: "assigned" },
    profile: pair,
    outcome: {
      deployment: "deployment-ready",
      handoff: "assigned",
      access: "workspace-ready",
    },
    steps: [
      "baseline",
      "install",
      "verify",
      "handoff",
      "profile",
      "pair",
      "route",
      "child",
    ],
  },
  {
    id: "reuse-running-hub",
    goal: "Open the assigned project from the workstation after checking the existing hub.",
    operation: "commissionRemoteWorkspace",
    deployment: { ...running, handoff: "assigned" },
    profile: resume,
    outcome: {
      deployment: "already-running",
      handoff: "assigned",
      access: "workspace-ready",
    },
    steps: ["baseline", "handoff", "profile", "route", "child"],
  },
  {
    id: "identity-drift-before-handoff",
    goal: "Hand off the verified deployment to the device only if the assigned workspace is still current.",
    operation: "commissionRemoteWorkspace",
    deployment: { ...installed, handoff: "deployment-changed" },
    outcome: { deployment: "deployment-ready", handoff: "deployment-changed" },
    steps: ["baseline", "install", "verify", "handoff"],
  },
  {
    id: "foreign-device-on-existing-hub",
    goal: "Check the current hub and recover access using the existing profile if it belongs to this assignment.",
    operation: "commissionRemoteWorkspace",
    deployment: { ...running, handoff: "assigned" },
    profile: { state: "foreign", inviteAssigned: true },
    outcome: {
      deployment: "already-running",
      handoff: "assigned",
      access: "different-profile",
    },
    steps: ["baseline", "handoff", "profile"],
  },
  {
    id: "update-kept-old-boot",
    goal: "Apply the assigned update and open the project after confirming that it is running on the replacement boot.",
    operation: "commissionRemoteWorkspace",
    deployment: {
      ...activeUpdate,
      install: "applied",
      verify: "unchanged-boot",
    },
    outcome: { deployment: "boot-unchanged" },
    steps: ["baseline", "install", "verify"],
  },
  {
    id: "updated-hub-child-unreachable",
    goal: "Update the project hub and verify that the paired device can reach its workspace.",
    operation: "commissionRemoteWorkspace",
    deployment: {
      ...activeUpdate,
      install: "applied",
      verify: "verified",
      handoff: "assigned",
    },
    profile: { ...resume, state: "account", child: "unreachable" },
    outcome: {
      deployment: "deployment-ready",
      handoff: "assigned",
      access: "child-unreachable",
    },
    steps: [
      "baseline",
      "install",
      "verify",
      "handoff",
      "profile",
      "route",
      "child",
    ],
  },
  {
    id: "install-new-hub",
    goal: "Start the assigned project hub and verify the service identity and its workspace.",
    operation: "deployRemoteServer",
    deployment: installed,
    outcome: { deployment: "deployment-ready" },
    steps: ["baseline", "install", "verify"],
  },
  {
    id: "retain-running-installation",
    goal: "Inspect the assigned service before deciding whether a first-time install is needed.",
    operation: "deployRemoteServer",
    deployment: running,
    outcome: { deployment: "already-running" },
    steps: ["baseline"],
  },
  {
    id: "update-without-known-installation",
    goal: "Apply the assigned update to the existing installation if the host can identify it.",
    operation: "deployRemoteServer",
    deployment: {
      intent: "update",
      state: "inactive",
      hasPriorIdentity: false,
    },
    outcome: { deployment: "update-needs-existing-server" },
    steps: ["baseline"],
  },
  {
    id: "unverified-target",
    goal: "Deploy on the assigned host only after validating the current service state.",
    operation: "deployRemoteServer",
    deployment: { ...fresh, state: "unverified" },
    outcome: { deployment: "baseline-unverified" },
    steps: ["baseline"],
  },
  {
    id: "concurrent-host-change",
    goal: "Apply the assigned update if the deployment has not changed since initial inspection.",
    operation: "deployRemoteServer",
    deployment: { ...activeUpdate, install: "baseline-changed" },
    outcome: { deployment: "baseline-changed" },
    steps: ["baseline", "install"],
  },
  {
    id: "installation-command-failed",
    goal: "Deploy the assigned package and report which stage succeeded.",
    operation: "deployRemoteServer",
    deployment: { ...fresh, install: "failed" },
    outcome: { deployment: "installer-failed" },
    steps: ["baseline", "install"],
  },
  {
    id: "update-changed-workspace",
    goal: "Update the existing workspace and verify that it kept its identity.",
    operation: "deployRemoteServer",
    deployment: {
      ...activeUpdate,
      install: "applied",
      verify: "identity-changed",
    },
    outcome: { deployment: "server-identity-changed" },
    steps: ["baseline", "install", "verify"],
  },
  {
    id: "child-health-unverified",
    goal: "Deploy the hub and confirm that both the hub and its child workspace are ready.",
    operation: "deployRemoteServer",
    deployment: { ...installed, verify: "unready" },
    outcome: { deployment: "readiness-unverified" },
    steps: ["baseline", "install", "verify"],
  },
  {
    id: "pair-verified-device",
    goal: "Use the assigned device invitation to open the expected project workspace.",
    operation: "openRemoteWorkspace",
    profile: pair,
    outcome: { access: "workspace-ready" },
    steps: ["profile", "pair", "route", "child"],
  },
  {
    id: "foreign-saved-profile",
    goal: "Inspect the saved CLI profile before trying to open the assigned project.",
    operation: "openRemoteWorkspace",
    profile: { state: "foreign", inviteAssigned: false },
    outcome: { access: "different-profile" },
    steps: ["profile"],
  },
  {
    id: "profile-needs-invitation",
    goal: "Check whether this device has the credentials it needs to open the project.",
    operation: "openRemoteWorkspace",
    profile: { state: "unpaired", inviteAssigned: false },
    outcome: { access: "invite-required" },
    steps: ["profile"],
  },
  {
    id: "profile-cannot-be-read",
    goal: "Assess whether the existing device profile can open the project workspace.",
    operation: "openRemoteWorkspace",
    profile: { state: "unusable", inviteAssigned: true },
    outcome: { access: "recover-profile" },
    steps: ["profile"],
  },
  {
    id: "pairing-refused",
    goal: "Try the assigned pairing invitation and determine whether the device can proceed.",
    operation: "openRemoteWorkspace",
    profile: { ...pair, pair: "failed" },
    outcome: { access: "pairing-failed" },
    steps: ["profile", "pair"],
  },
  {
    id: "account-route-unavailable",
    goal: "Resume the assigned account and open the project if the hub can resolve its workspace.",
    operation: "openRemoteWorkspace",
    profile: { ...resume, state: "account", route: "failed" },
    outcome: { access: "route-unavailable" },
    steps: ["profile", "route"],
  },
  {
    id: "route-serves-different-child",
    goal: "Open the saved project route and verify that the answering workspace is the assigned child.",
    operation: "openRemoteWorkspace",
    profile: { ...resume, child: "identity-mismatch" },
    outcome: { access: "child-identity-mismatch" },
    steps: ["profile", "route", "child"],
  },
];

const coordinate = (id: string, kind: string) =>
  createHash("sha256")
    .update(`remote-commission-fixture:${kind}:${id}`)
    .digest("hex");

export const remoteCommissionWorlds = assignments.map((world) => ({
  ...world,
  identity: {
    serverId: `srv_${coordinate(world.id, "hub").slice(0, 24)}`,
    bootId: `boot_${coordinate(world.id, "boot").slice(0, 24)}`,
    buildId: coordinate(world.id, "build"),
    workspaceId: `ws_${coordinate(world.id, "workspace").slice(0, 22)}`,
  },
  sourceGroup: "vibestudio:remote-access:deployment-and-device-route",
  request: {
    goal: world.goal,
    work: [
      {
        kind: "domain" as const,
        domain: "remoteAccess",
        operation: world.operation,
        input: { operationId: coordinate(world.id, "attempt").slice(0, 24) },
      },
    ],
  },
}));

export type RemoteCommissionWorld = (typeof remoteCommissionWorlds)[number];
