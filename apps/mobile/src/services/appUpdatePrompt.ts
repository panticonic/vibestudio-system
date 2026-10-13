import { Alert } from "react-native";
import type { ShellClient } from "./shellClient";
import type { ToastInput } from "../state/toastAtoms";
import type { SupervisionChange } from "@vibestudio/shared/events";

export interface AppUpdatePromptDeps {
  shellClient: ShellClient;
  pushToast: (toast: ToastInput) => void;
  prompted: Set<string>;
  selectedSource?: string | null;
  selectedAppId?: string | null;
  alert?: typeof Alert.alert;
  ensureBundle?: EnsureBundleFn;
}

type EnsureBundleFn = (
  transport: ShellClient["transport"],
  source?: string | null
) => Promise<unknown>;

/**
 * React to a supervision change of the mobile app: ask before installing an
 * update, and say plainly when an update was refused or the app rolled back.
 */
export function handleMobileSupervisionChange(
  change: SupervisionChange,
  deps: AppUpdatePromptDeps
): void {
  if (!isSelectedMobileApp(change, deps)) return;
  const appId = change.identity.entityId;
  if (change.change === "adopted" && change.adoption === "prompt") {
    promptMobileUpdate(change, deps);
    return;
  }
  if (change.change === "update-rejected") {
    deps.pushToast({
      title: "Update not adopted",
      message: `${change.lastError ?? "The new version could not be installed."} The previous version keeps running.`,
      tone: "danger",
      durationMs: 10000,
    });
    return;
  }
  if (change.change === "rolled-back") {
    deps.pushToast({
      title: "App rolled back",
      message: `${appId} is using the previous trusted build.`,
      tone: "success",
    });
  }
}

function isSelectedMobileApp(change: SupervisionChange, deps: AppUpdatePromptDeps): boolean {
  if (change.identity.kind !== "app" || change.app?.target !== "react-native") return false;
  const selectedSource = deps.selectedSource ? normalizeSource(deps.selectedSource) : null;
  if (selectedSource && normalizeSource(change.source) !== selectedSource) return false;
  if (deps.selectedAppId && change.identity.entityId !== deps.selectedAppId) return false;
  return true;
}

function normalizeSource(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

async function defaultEnsureBundle(
  transport: ShellClient["transport"],
  source?: string | null
): Promise<unknown> {
  const { ensureNativeWorkspaceAppBundle } = await import("./appBootstrap");
  return ensureNativeWorkspaceAppBundle(transport, source);
}

/**
 * Build a version-aware update message. Surfaces the target version (and the
 * version being replaced, when both are known) so the prompt isn't blind about
 * what it's installing; falls back to generic copy when the server didn't
 * report versions.
 */
function formatUpdateMessage(change: SupervisionChange, appId: string): string {
  const next = change.artifact.effectiveVersion?.trim();
  const prev = change.previousEffectiveVersion?.trim();
  if (next && prev && next !== prev) {
    return `${appId} v${prev} → v${next} is ready to install.`;
  }
  if (next) {
    return `${appId} v${next} is ready to install.`;
  }
  return `${appId} has a new trusted bundle ready to install.`;
}

function promptMobileUpdate(change: SupervisionChange, deps: AppUpdatePromptDeps): void {
  const appId = change.identity.entityId;
  // Version awareness: ignore no-op events where the "new" build is the one
  // already running -- e.g. a lifecycle event re-emitted (on reconnect) for a
  // build the user already installed. The server reports the build being
  // replaced as previousBuildKey.
  const buildKey = change.artifact.buildKey;
  if (buildKey && change.previousBuildKey && buildKey === change.previousBuildKey) return;
  const promptKey = `${appId}:${buildKey ?? "unknown"}`;
  if (deps.prompted.has(promptKey)) return;
  deps.prompted.add(promptKey);
  const ensureBundle = deps.ensureBundle ?? defaultEnsureBundle;
  const alert = deps.alert ?? Alert.alert;
  alert("Mobile app update available", formatUpdateMessage(change, appId), [
    { text: "Later", style: "cancel" },
    ...(change.canRollback
      ? [
          {
            text: "Roll back",
            style: "destructive" as const,
            onPress: () => {
              void deps.shellClient.workspaces
                .rollbackApp(appId)
                .then(() =>
                  ensureBundle(
                    deps.shellClient.transport,
                    change.source
                  )
                )
                .catch((error: unknown) => {
                  deps.pushToast({
                    title: "Rollback failed",
                    message: error instanceof Error ? error.message : String(error),
                    tone: "danger",
                    durationMs: 10000,
                  });
                });
            },
          },
        ]
      : []),
    {
      text: "Install",
      onPress: () => {
        void ensureBundle(
          deps.shellClient.transport,
          change.source
        ).catch((error: unknown) => {
          deps.pushToast({
            title: "Update failed",
            message: error instanceof Error ? error.message : String(error),
            tone: "danger",
            durationMs: 10000,
          });
        });
      },
    },
  ]);
}
