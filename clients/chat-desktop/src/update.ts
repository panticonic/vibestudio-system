import { useEffect, useMemo } from "react";
import {
  createClientUpdateModel,
  type ClientUpdateModel,
  type PendingClientUpdate,
} from "@workspace/client-update-core";
import type { ClientUpdateOffer, HostBridge } from "./hostBridge";

function pendingFrom(offer: ClientUpdateOffer): PendingClientUpdate {
  return {
    clientId: offer.clientId,
    source: offer.source,
    runtime: "web",
    buildKey: offer.buildKey,
    toVersion: offer.effectiveVersion?.trim() || null,
    fromVersion: offer.previousEffectiveVersion?.trim() || null,
    canRollback: false,
  };
}

/**
 * This client's update model, fed by the host's offer for it and acting through
 * the host: the desktop swaps only this client's windows to the pending build.
 * Returns the model and the function that stops following the host.
 */
export function createChatUpdateModel(host: HostBridge): {
  model: ClientUpdateModel;
  dispose(): void;
} {
  const { update } = host.client;
  const model = createClientUpdateModel({
    scope: { runtime: "web", clientId: host.transport.identity.runtimeId.split(":")[1] ?? null },
    port: {
      apply: () => update.restartAtSafePoint(),
      rollback: () => Promise.reject(new Error("The desktop host does not roll a client back.")),
    },
  });
  const show = (offer: ClientUpdateOffer | null) =>
    model.seed(offer ? [pendingFrom(offer)] : []);
  let live = true;
  void update.pending().then(
    (offer) => {
      if (live) show(offer);
    },
    () => undefined
  );
  const stop = update.onUpdate(show);
  return {
    model,
    dispose() {
      live = false;
      stop();
    },
  };
}

export function useChatUpdates(host: HostBridge): ClientUpdateModel {
  const owned = useMemo(() => createChatUpdateModel(host), [host]);
  useEffect(() => owned.dispose, [owned]);
  return owned.model;
}
