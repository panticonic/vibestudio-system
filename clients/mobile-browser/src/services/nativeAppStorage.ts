/**
 * The sole workspace-client boundary to device-local key/value state.
 *
 * Client-local persistence is runtime plumbing, like a browser app's
 * localStorage: it does not grant access to another unit. The host keeps it,
 * scoped to this client on this device, and serves it through the client API;
 * the client holds no storage module of its own.
 */

import { clientApi } from "@workspace/client-kit-native/host";

export interface NativeAppStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export function getNativeAppStorage(): NativeAppStorage {
  const { state } = clientApi();
  return {
    getItem: (key) => state.get(key),
    setItem: (key, value) => state.set(key, value),
    removeItem: (key) => state.remove(key),
  };
}
