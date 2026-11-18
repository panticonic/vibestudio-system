import type { LocalModelEntry } from "@workspace/model-catalog/localModels";
import type {
  LocalTaskInventoryRow,
  LocalTaskReceipt,
} from "../local-model-task/types.js";

export type LocalTaskSource = {
  listModels(): Promise<LocalModelEntry[]>;
  installModel(ref: string): Promise<unknown>;
};
export type LocalTaskAssignment = {
  modelRef: string;
  authorizedInstallRef: string | null;
};

export function inventoryRow(
  inventory: LocalModelEntry[],
  ref: string,
): LocalTaskInventoryRow | null {
  const matches = inventory.filter((row) => "local:" + row.slug === ref);
  if (matches.length > 1)
    throw new Error("The assigned local model has duplicate inventory rows");
  const row = matches[0];
  if (!row) return null;
  return {
    ref,
    state: row.state,
    fit: row.fit.fit,
    toolsCapable: row.toolsCapable,
    contextWindow: row.contextWindow,
    progress: row.download?.progress ?? null,
    errorMessage: row.errorMessage,
  };
}

function completedReceipt(
  expectedRef: string,
  value: unknown,
): LocalTaskReceipt {
  if (value === null) return { kind: "validated-existing", ref: expectedRef };
  if (
    typeof value !== "object" ||
    !("id" in value) ||
    !("slug" in value) ||
    !("error" in value) ||
    typeof value.id !== "string" ||
    value.id.length === 0 ||
    typeof value.slug !== "string" ||
    "local:" + value.slug !== expectedRef ||
    value.error !== null
  ) {
    throw new Error(
      "The local-model extension did not return a completed installation for the assigned model",
    );
  }
  return { kind: "installed", ref: expectedRef, jobId: value.id };
}

/** The caller grants one exact persistent effect. The model sees neither the granting host nor endpoint credentials. */
export function bindLocalModelTask(
  source: LocalTaskSource,
  { modelRef, authorizedInstallRef }: LocalTaskAssignment,
) {
  if (
    !/^local:[^:/\s]+$/u.test(modelRef) ||
    (authorizedInstallRef !== null && authorizedInstallRef !== modelRef)
  ) {
    throw new Error("Grant installation only for the assigned local model ref");
  }
  let attempted = false;
  const inspect = async (
    ref: string,
  ): Promise<LocalTaskInventoryRow | null> => {
    if (ref !== modelRef)
      throw new Error("Inspect only the assigned local model");
    const inventory = await source.listModels();
    return inventoryRow(inventory, ref);
  };
  const installOnce = async (ref: string): Promise<LocalTaskReceipt> => {
    if (ref !== modelRef || ref !== authorizedInstallRef) {
      throw new Error(
        "The caller has not authorized installation of this model",
      );
    }
    if (attempted)
      throw new Error("This assignment already attempted installation");
    attempted = true;
    const current = await inspect(ref);
    if (current?.state !== "not-installed" || current.fit === "too-big") {
      return { kind: "state-changed", ref };
    }
    return completedReceipt(ref, await source.installModel(ref));
  };
  return {
    localModelTaskInventory: Object.freeze({ inspect }),
    localModelTaskInstall: Object.freeze({ installOnce }),
  };
}
