import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { ClientUpdatePrompt } from "@workspace/client-kit-web";
import {
  createClientUpdateModel,
  type ClientUpdateModel,
  type PendingClientUpdate,
} from "@workspace/client-update-core";
import { useShellWorkspaceClient } from "../shell/workspaceContext";
import { useShellEvent } from "../shell/useShellEvent";

const ClientUpdatesContext = createContext<ClientUpdateModel | null>(null);

export function useClientUpdates(): ClientUpdateModel {
  const model = useContext(ClientUpdatesContext);
  if (!model) throw new Error("useClientUpdates needs a DesktopClientUpdates provider");
  return model;
}

/**
 * This window's client updates: one model, fed by the server's
 * `supervision:changed` announcements (plus what the host persisted across a
 * restart), taken through the host bridge (`app.applyUpdate`).
 */
export function DesktopClientUpdates({ children }: { children: ReactNode }) {
  const { app, supervisedUnits } = useShellWorkspaceClient();
  const [model] = useState(() =>
    createClientUpdateModel({
      scope: { runtime: "web" },
      port: {
        apply: async (update) => {
          const result = await app.applyUpdate(update.clientId);
          if (!result.applied)
            throw new Error(`${update.clientId} has no pending desktop update.`);
        },
        rollback: async (update) => {
          await supervisedUnits.rollback(update.clientId);
        },
      },
    }),
  );
  const seed = useCallback(async () => {
    const [pending, units] = await Promise.all([app.listPendingUpdates(), supervisedUnits.list()]);
    const updates: PendingClientUpdate[] = [];
    for (const update of pending) {
      const unit = units.find(
        (candidate) =>
          candidate.identity.kind === "client" && candidate.identity.entityId === update.appId,
      );
      if (!unit) continue;
      const versions = await supervisedUnits.versions(update.appId);
      updates.push({
        clientId: update.appId,
        source: unit.source,
        runtime: "web",
        buildKey: update.buildKey ?? null,
        toVersion: update.effectiveVersion?.trim() || null,
        fromVersion: update.previousEffectiveVersion?.trim() || null,
        canRollback: versions.previous.length > 0,
      });
    }
    model.seed(updates);
  }, [app, supervisedUnits, model]);
  // Updates the host kept across a restart are on offer from the start.
  useEffect(() => {
    void seed().catch((error: unknown) =>
      console.warn("[DesktopClientUpdates] could not read pending updates:", error),
    );
  }, [seed]);
  useShellEvent("supervision:changed", useCallback((change) => model.handleChange(change), [model]));
  return <ClientUpdatesContext.Provider value={model}>{children}</ClientUpdatesContext.Provider>;
}

/** The prompt, where the chrome shows its notices. */
export function DesktopClientUpdatePrompt() {
  return <ClientUpdatePrompt model={useClientUpdates()} />;
}
