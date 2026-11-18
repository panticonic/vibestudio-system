import { localModelsExtensionMethods } from "@workspace/model-catalog/localModels";
import { bindLocalModelTask, type LocalTaskAssignment } from "./bind.js";

export type { LocalTaskAssignment } from "./bind.js";
export type LocalTaskExtensionPort = {
  invoke(extension: string, method: string, args: unknown[]): Promise<unknown>;
};

const EXTENSION = "@workspace-extensions/local-models";

export function createLocalModelTaskBindings(
  extensions: LocalTaskExtensionPort,
  assignment: LocalTaskAssignment,
) {
  return bindLocalModelTask(
    {
      async listModels() {
        const method = localModelsExtensionMethods.listModels;
        return method.result.parse(
          await extensions.invoke(EXTENSION, method.method, []),
        );
      },
      installModel: (ref) =>
        extensions.invoke(EXTENSION, "installModel", [ref]),
    },
    assignment,
  );
}
