import { createTypedRpcServiceClient } from "@vibestudio/shared/typedRpcServiceClient";
import { runtimeMethods } from "@vibestudio/service-schemas/runtime";
import {
  createClientUpdateModel,
  type ClientUpdateModel,
  type ClientUpdatePort,
} from "@workspace/client-update-core";
import type { ShellClient } from "./shellClient";

export type EnsureBundleFn = (
  transport: ShellClient["transport"],
  source?: string | null
) => Promise<unknown>;

async function defaultEnsureBundle(
  transport: ShellClient["transport"],
  source?: string | null
): Promise<unknown> {
  const { ensureNativeWorkspaceAppBundle } = await import("./appBootstrap");
  return ensureNativeWorkspaceAppBundle(transport, source);
}

/**
 * How this app takes a ready build of itself: fetch and install the bundle over
 * the active transport; to roll back, ask the server to restore the previous
 * trusted build and then take that one.
 */
export function mobileClientUpdatePort(
  shellClient: ShellClient,
  ensureBundle: EnsureBundleFn = defaultEnsureBundle
): ClientUpdatePort {
  const runtime = createTypedRpcServiceClient(
    shellClient.transport,
    { targetId: "main", namespace: "runtime" },
    runtimeMethods
  );
  return {
    apply: async (update) => {
      await ensureBundle(shellClient.transport, update.source);
    },
    rollback: async (update) => {
      await runtime.supervision.rollback({ kind: "client", releaseId: update.clientId });
      await ensureBundle(shellClient.transport, update.source);
    },
  };
}

/** The update model for the one client this app runs as (its selected source and id). */
export function createMobileClientUpdateModel(input: {
  shellClient: ShellClient;
  selectedSource: string;
  selectedClientId: string;
  ensureBundle?: EnsureBundleFn;
}): ClientUpdateModel {
  return createClientUpdateModel({
    scope: {
      runtime: "react-native",
      source: input.selectedSource,
      clientId: input.selectedClientId,
    },
    port: mobileClientUpdatePort(input.shellClient, input.ensureBundle),
  });
}
