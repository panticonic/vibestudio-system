import { mainRpcMethods } from "@vibestudio/service-schemas/mainRpc";
import { parseWorkspaceSystemEpochEnvelope } from "@vibestudio/workspace/configParser";
import { parseTemplateManifestContent } from "@vibestudio/workspace/templateManifest";
import {
  capabilitiesForHost,
  CURRENT_HOST_ABI,
  DEVICE_LEVEL_CAPABILITIES,
  HOST_RUNTIME,
  isClientCapability,
  isClientRuntime,
  type HostKind,
} from "@vibestudio/workspace-contracts/clients";
import { rpc, vcs } from "@workspace/runtime";
import type {
  ClientAdmissionObservation,
  ClientContract,
} from "./natlang/types.js";

type AdmissionPorts = {
  vcs: Pick<typeof vcs, "resolveRepository" | "readFile" | "status">;
  rpc: Pick<typeof rpc, "call">;
};

type State = Awaited<ReturnType<typeof vcs.status>>["workingHead"];

async function readText(
  vcs: AdmissionPorts["vcs"],
  state: State,
  repoPath: string,
  path: string,
) {
  const repository = await vcs.resolveRepository({ state, repoPath });
  if (!repository) throw new Error(`Missing assigned repository ${repoPath}`);
  const file = await vcs.readFile({
    state,
    repositoryId: repository.repositoryId,
    file: { kind: "path", path },
  });
  if (file?.content.kind !== "text")
    throw new Error(`Missing assigned source ${repoPath}/${path}`);
  return { hash: file.contentHash, text: file.content.text };
}

async function readContract(
  vcs: AdmissionPorts["vcs"],
  state: State,
  source: string,
): Promise<ClientContract> {
  const file = await readText(vcs, state, source, "package.json");
  const manifest = JSON.parse(file.text);
  const client = manifest.vibestudio?.client;
  const required: unknown = client?.capabilities?.required ?? [];
  const optional: unknown = client?.capabilities?.optional ?? [];
  if (
    typeof client?.id !== "string" ||
    !isClientRuntime(client.runtime) ||
    typeof client.hostAbi !== "string" ||
    !Array.isArray(required) ||
    !required.every(isClientCapability) ||
    !Array.isArray(optional) ||
    !optional.every(isClientCapability)
  )
    throw new Error("The assigned client needs a recognized manifest contract");
  return {
    hash: file.hash,
    id: client.id,
    runtime: client.runtime,
    abi: client.hostAbi,
    required,
    optional,
  };
}

export function bindClientAdmission(
  assignment: {
    contextId: string;
    source: string;
    host: HostKind;
    goal: string;
  },
  ports: AdmissionPorts = { rpc, vcs },
) {
  const { rpc, vcs } = ports;
  const { contextId, source, host, goal } = assignment;
  const operationId = crypto.randomUUID();
  return {
    request: { goal, operationId },
    services: {
      clientAdmissionRead: {
        async observe(id: string): Promise<ClientAdmissionObservation> {
          if (id !== operationId)
            throw new Error("Read only the assigned System client");
          const { workingHead, mainEventId } = await vcs.status({ contextId });
          const main = { kind: "event", eventId: mainEventId } as const;
          const publishedRead = readContract(vcs, main, source);
          const [working, published, meta, units] = await Promise.all([
            workingHead.kind === "event" && workingHead.eventId === mainEventId
              ? publishedRead
              : readContract(vcs, workingHead, source),
            publishedRead,
            readText(vcs, main, "meta", "vibestudio.yml"),
            rpc.call("main", mainRpcMethods["build.listUnits"], []),
          ]);
          const config = parseTemplateManifestContent(
            meta.text,
            parseWorkspaceSystemEpochEnvelope(meta.text),
          );
          const trusted = config.top.trust?.clients?.includes(source) ?? false;
          const catalog = units.find(
            (entry) => entry.kind === "client" && entry.source === source,
          );
          const runtime = HOST_RUNTIME[host];
          return {
            operationId,
            contextId,
            source,
            workingRevision:
              workingHead.kind === "event"
                ? workingHead.eventId
                : workingHead.applicationId,
            mainRevision: mainEventId,
            working,
            published,
            trusted,
            host: {
              kind: host,
              runtimes: { [runtime]: CURRENT_HOST_ABI[runtime] },
              capabilities: [...capabilitiesForHost(host)],
              deviceLevel: [...DEVICE_LEVEL_CAPABILITIES],
            },
            catalog: catalog
              ? {
                  source: catalog.source,
                  status: catalog.status,
                  effectiveVersion: catalog.effectiveVersion,
                  activeBuildKey: catalog.activeBuildKey,
                }
              : null,
          };
        },
      },
    },
  };
}
