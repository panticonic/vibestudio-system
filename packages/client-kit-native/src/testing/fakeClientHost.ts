import {
  createRnClientApi,
  type ClientDescription,
  type ClientHostEvent,
  type ClientHostMethod,
  type ClientIntent,
  type RnClientApi,
  type SessionKind,
  type SessionOpened,
  type UpdateOffer,
} from "@vibestudio/rn-client-api";
import { createMemoryBroker } from "@vibestudio/rn-client-api/testing";
import type { ClientCapability } from "@vibestudio/workspace-contracts/clients";

export interface FakeClientHostOptions {
  granted?: ClientCapability[];
  intent?: ClientIntent | null;
  pending?: UpdateOffer | null;
  source?: string;
  /** Answer (or override the answer to) a host method; unlisted methods get the defaults. */
  handlers?: Partial<Record<ClientHostMethod, (...args: any[]) => unknown>>;
}

export interface FakeClientHost {
  /** The real client API, built over an in-memory broker to this fake host. */
  api: RnClientApi;
  /** Every request the client made, in order. */
  calls: Array<{ method: ClientHostMethod; args: unknown[] }>;
  /** Deliver a host event to the client. */
  emit(event: ClientHostEvent): void;
  /** The state the client persisted through `api.state`. */
  state: Map<string, string>;
  callsOf(method: ClientHostMethod): unknown[][];
}

const DEVICE_ID = "device-1";
const SERVER_ID = "a".repeat(64);

/**
 * A host for client tests: the client API is the real one, over an in-memory
 * broker with the broker's contract (JSON in, JSON out). Sessions open
 * successfully and idle; tests that need traffic answer `session.postEnvelope`
 * or emit session events themselves.
 */
export async function createFakeClientHost(
  options: FakeClientHostOptions = {}
): Promise<FakeClientHost> {
  const source = options.source ?? "clients/mobile-browser";
  const description: ClientDescription = {
    principalId: `client:browser:react-native:${DEVICE_ID}`,
    clientId: "browser",
    source,
    title: "Vibestudio",
    buildKey: "build-1",
    effectiveVersion: "1.0.0",
    deviceId: DEVICE_ID,
    platform: "android",
    grantedCapabilities: options.granted ?? [
      "device-session",
      "panel-hosting",
      "approval-surface",
      "hub-control",
      "clipboard",
      "open-external",
      "browser-import",
    ],
    developmentMode: false,
    intent: options.intent ?? null,
  };
  const state = new Map<string, string>();
  const calls: FakeClientHost["calls"] = [];
  const sessions = new Map<string, SessionOpened>();
  const opened = (kind: SessionKind, sessionId: string, callerId: string): SessionOpened => {
    const description: SessionOpened = {
      sessionId,
      kind,
      callerId,
      callerKind: kind === "principal" ? "client" : kind === "shell" ? "shell" : "panel",
      deviceId: DEVICE_ID,
      serverId: SERVER_ID,
      status: "connected",
    };
    sessions.set(sessionId, description);
    return description;
  };
  const defaults: Partial<Record<ClientHostMethod, (...args: any[]) => unknown>> = {
    "client.describe": () => description,
    "updates.pending": () => options.pending ?? null,
    "updates.restartAtSafePoint": () => undefined,
    "updates.rollback": () => undefined,
    "state.get": (key: string) => state.get(key) ?? null,
    "state.set": (key: string, value: string) => void state.set(key, value),
    "state.remove": (key: string) => void state.delete(key),
    "state.keys": () => [...state.keys()],
    "session.openPrincipal": (id: string) => opened("principal", id, description.principalId),
    "session.openAccountControl": (id: string) => opened("shell", id, `shell:${DEVICE_ID}`),
    "session.openWorkspace": (id: string) => opened("shell", id, `shell:${DEVICE_ID}`),
    "session.openAuxiliary": (id: string, spec: { label: string }) =>
      opened("auxiliary", id, `panel:${spec.label}`),
    "session.ready": (id: string) => sessions.get(id),
    "session.close": () => undefined,
    "session.waitUntilConnected": () => undefined,
    "session.provideToken": () => undefined,
    "clipboard.setString": () => undefined,
    "openExternal.open": () => undefined,
    "integration.install": () => ({ outcome: "requested" }),
    "integration.list": () => [],
    "integration.remove": () => undefined,
    "device.reset": () => undefined,
    "device.setDevelopmentMode": () => undefined,
  };
  const { channel, host } = createMemoryBroker((method, args) => {
    calls.push({ method, args });
    const handler = options.handlers?.[method] ?? defaults[method];
    if (!handler) throw new Error(`The fake client host has no answer for ${method}`);
    return handler(...args);
  });
  const api = await createRnClientApi(channel);
  return {
    api,
    calls,
    emit: (event) => host.emit(event),
    state,
    callsOf: (method) => calls.filter((call) => call.method === method).map((call) => call.args),
  };
}
