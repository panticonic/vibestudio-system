import type { RnClientApi } from "@vibestudio/rn-client-api";
import {
  createClientUpdateModel,
  type ClientUpdateModel,
  type ClientUpdatePort,
} from "@workspace/client-update-core";

/**
 * How this client takes a ready build of itself: the host owns the instance, so
 * both taking the build and returning to the previous one are requests to the
 * host, which reloads only this client's instance.
 */
export function clientUpdatePortFromHost(api: RnClientApi): ClientUpdatePort {
  return {
    apply: () => api.updates.restartAtSafePoint(),
    rollback: () => api.updates.rollback(),
  };
}

/**
 * Feed `model` from the host's update observation: the offer the host already
 * holds, then every later one. Each offer carries the server's announcement.
 * Returns the retirement function.
 */
export function observeHostUpdates(api: RnClientApi, model: ClientUpdateModel): () => void {
  const pending = api.updates.pending();
  if (pending) model.handleChange(pending.change);
  return api.updates.onUpdate((offer) => model.handleChange(offer.change));
}

/** The update model for this one client, fed by and acting through the host. */
export function createHostUpdateModel(api: RnClientApi): ClientUpdateModel {
  return createClientUpdateModel({
    scope: { runtime: "react-native", source: api.client.source },
    port: clientUpdatePortFromHost(api),
  });
}
