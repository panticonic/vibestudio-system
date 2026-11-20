import type { SupervisionChange } from "@vibestudio/shared/events";
import type {
  ClientUpdateModel,
  PendingClientUpdate,
} from "@workspace/client-update-core";

type RetainedOffer = {
  appId: string;
  buildKey?: string | null;
  effectiveVersion?: string | null;
  previousEffectiveVersion?: string | null;
};
type Unit = { identity: { kind: string; entityId: string }; source: string };

/** The desktop browser only displays retained host offers for present client units. */
export async function projectRetainedDesktopUpdates(
  pending: readonly RetainedOffer[],
  units: readonly Unit[],
  previousBuilds: (id: string) => Promise<number>,
): Promise<PendingClientUpdate[]> {
  const updates: PendingClientUpdate[] = [];
  for (const update of pending) {
    const unit = units.find(
      (candidate) =>
        candidate.identity.kind === "client" &&
        candidate.identity.entityId === update.appId,
    );
    if (!unit) continue;
    updates.push({
      clientId: update.appId,
      source: unit.source,
      runtime: "web",
      buildKey: update.buildKey ?? null,
      toVersion: update.effectiveVersion?.trim() || null,
      fromVersion: update.previousEffectiveVersion?.trim() || null,
      canRollback: (await previousBuilds(update.appId)) > 0,
    });
  }
  return updates;
}

/** Offers come from the desktop host. Its supervision stream contributes notices. */
export function applyDesktopUpdateNotice(
  model: Pick<ClientUpdateModel, "handleChange">,
  change: SupervisionChange,
): void {
  if (change.change !== "adopted") model.handleChange(change);
}
