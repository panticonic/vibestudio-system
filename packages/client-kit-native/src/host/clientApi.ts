import type { RnClientApi } from "@vibestudio/rn-client-api";
import type { ClientCapability } from "@vibestudio/workspace-contracts/clients";

/**
 * The host API of this client instance (`@vibestudio/rn-client-api`).
 *
 * A client instance talks to exactly one host, so the API is built once at
 * startup and installed here; services and components read it with
 * {@link clientApi}. Tests install a fake. This module imports no raw native
 * module: everything device-owned is reached through the API.
 */
let installed: RnClientApi | null = null;

export function installClientApi(api: RnClientApi): void {
  installed = api;
}

/** The installed host API; reading it before startup installed one is a defect. */
export function clientApi(): RnClientApi {
  if (!installed) throw new Error("The host API has not been installed for this client instance");
  return installed;
}

export function hasClientCapability(capability: ClientCapability): boolean {
  return clientApi().capabilities.has(capability);
}

/** Throw unless the host currently grants `capability`; `surface` names what asked. */
export function requireClientCapability(capability: ClientCapability, surface: string): void {
  if (hasClientCapability(capability)) return;
  throw new Error(`${surface} requires the granted client capability '${capability}'`);
}
