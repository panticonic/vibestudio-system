import type { LocalModelEntry } from "@workspace/model-catalog/localModels";
import { createLocalModelTaskBindings } from "./binding.js";
import type { LocalTaskWorld } from "./worlds.js";

export type LocalTaskFixtureOperation = "listModels" | "installModel";

/** Exercise the real adapter contract using an isolated, replayable extension port. */
export function createLocalModelTaskFixture(world: LocalTaskWorld) {
  const { modelRef } = world.request;
  const slug = modelRef.slice("local:".length);
  let read = 0;
  const operations: LocalTaskFixtureOperation[] = [];
  const bindings = createLocalModelTaskBindings(
    {
      async invoke(extension, method, args) {
        if (extension !== "@workspace-extensions/local-models")
          throw new Error("Unexpected fixture extension");
        if (method === "listModels" && args.length === 0) {
          operations.push("listModels");
          if (read >= world.snapshots.length)
            throw new Error("Fixture inventory was read too many times");
          const snapshot = world.snapshots[read++];
          if (!snapshot) return [];
          return [
            {
              slug,
              displayName: "Fixture model",
              baseUrl: "https://local-fixture.invalid",
              server: "main",
              maxTokens: snapshot.contextWindow ?? 8192,
              contextWindow: snapshot.contextWindow ?? 8192,
              toolsCapable: snapshot.toolsCapable ?? true,
              reasoningCapable: false,
              fit: {
                fit: snapshot.fit ?? "full-gpu",
                estTokensPerSec: null,
                contextLength: 8192,
                gpuLayers: 0,
                notes: [],
              },
              measuredTokensPerSec: null,
              state: snapshot.state,
              download:
                snapshot.state === "downloading"
                  ? {
                      progress: 0.25,
                      phase: "active",
                      receivedBytes: 25,
                      totalBytes: 100,
                    }
                  : null,
              errorMessage:
                snapshot.state === "error"
                  ? "Fixture validation could not load the model"
                  : null,
            },
          ] satisfies LocalModelEntry[];
        }
        if (
          method !== "installModel" ||
          args.length !== 1 ||
          args[0] !== modelRef ||
          !world.installation
        ) {
          throw new Error("Unexpected fixture installation");
        }
        operations.push("installModel");
        if (world.installation === "reject")
          throw new Error("Model validation was refused");
        if (world.installation === "existing") return null;
        return {
          id: "install-" + slug,
          slug: world.installation === "wrong-model" ? "unassigned" : slug,
          hfRepo: "fixtures/model",
          file: "fixture.gguf",
          totalBytes: 100,
          receivedBytes: 100,
          phase: "active",
          error: null,
        };
      },
    },
    {
      modelRef,
      authorizedInstallRef: world.authorizedInstall ? modelRef : null,
    },
  );
  return { bindings, audit: () => [...operations] };
}
