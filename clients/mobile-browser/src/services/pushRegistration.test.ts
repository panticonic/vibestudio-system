const scope = {
  serverId: "srv_aaaaaaaaaaaaaaaaaaaaaaaa",
  userId: "alice",
  workspaceId: "project",
};
const target = { ...scope, approvalId: "approval-1" };

import { AppState } from "react-native";
import { registerForPushNotifications } from "./pushRegistration";

const appStateSpy = jest
  .spyOn(AppState, "addEventListener")
  .mockImplementation(() => ({ remove: jest.fn() }));
afterAll(() => appStateSpy.mockRestore());

type Status = {
  configured: boolean;
  permission: "granted" | "denied" | "undetermined";
  token: string | null;
  platform: "android" | "ios";
  deviceClientId: string;
};

function createHarness(status: Partial<Status> = {}) {
  const state = new Map<string, string>();
  const listeners = {
    token: undefined as ((token: string) => void) | undefined,
    open: undefined as ((open: unknown) => void) | undefined,
    recovery: undefined as (() => void) | undefined,
  };
  const notifications = {
    status: jest.fn(
      async (): Promise<Status> => ({
        configured: true,
        permission: "granted",
        token: "token-1",
        platform: "android",
        deviceClientId: "device-1",
        ...status,
      })
    ),
    requestPermission: jest.fn(async () => true),
    display: jest.fn(),
    cancel: jest.fn(async () => undefined),
    displayed: jest.fn(async (): Promise<Array<{ id: string; data: Record<string, unknown> }>> => []),
    takeInitialOpen: jest.fn(async (): Promise<unknown> => null),
    onOpen: jest.fn((cb: (open: unknown) => void) => {
      listeners.open = cb;
      return jest.fn();
    }),
    onTokenChange: jest.fn((cb: (token: string) => void) => {
      listeners.token = cb;
      return jest.fn();
    }),
  };
  const api = {
    notifications,
    state: {
      get: jest.fn(async (key: string) => state.get(key) ?? null),
      set: jest.fn(async (key: string, value: string) => void state.set(key, value)),
    },
  };
  const shellClient = {
    pushScope: scope,
    transport: {
      onRecovery: jest.fn((cb: () => void) => {
        listeners.recovery = cb;
        return jest.fn();
      }),
    },
    shellApproval: { listPending: jest.fn(async () => [{ approvalId: "approval-1" }]) },
    push: { register: jest.fn(async () => undefined) },
  };
  return { api, notifications, shellClient, listeners, state };
}
const register = (h: ReturnType<typeof createHarness>, callbacks = {}) =>
  registerForPushNotifications(h.api as never, h.shellClient as never, callbacks);

describe("pushRegistration", () => {
  it("does nothing when the host build has no push configured", async () => {
    const h = createHarness({ configured: false });
    await register(h);
    expect(h.shellClient.push.register).not.toHaveBeenCalled();
    expect(h.notifications.requestPermission).not.toHaveBeenCalled();
  });

  it("registers the host's token under the host's device client id, then every refreshed token", async () => {
    const h = createHarness();
    await register(h);
    h.listeners.token?.("token-2");
    await Promise.resolve();
    expect(h.shellClient.push.register.mock.calls).toEqual([
      [{ token: "token-1", platform: "android", clientId: "device-1" }],
      [{ token: "token-2", platform: "android", clientId: "device-1" }],
    ]);
    expect(h.notifications.requestPermission).not.toHaveBeenCalled();
  });

  it("registers after the person grants permission", async () => {
    const h = createHarness({ permission: "undetermined", token: "token-1" });
    await register(h);
    expect(h.notifications.requestPermission).toHaveBeenCalled();
    expect(h.shellClient.push.register).toHaveBeenCalledTimes(1);
  });

  it("toasts once a week and does not register when permission is denied", async () => {
    const h = createHarness({ permission: "denied", token: null });
    h.notifications.requestPermission.mockResolvedValue(false);
    const onToast = jest.fn();
    await register(h, { onToast });
    await register(h, { onToast });
    expect(onToast).toHaveBeenCalledTimes(1);
    expect(onToast).toHaveBeenCalledWith(expect.objectContaining({ title: "Notifications are off" }));
    expect(h.shellClient.push.register).not.toHaveBeenCalled();
  });

  it("toasts and keeps going when the initial registration fails", async () => {
    const h = createHarness();
    h.shellClient.push.register.mockRejectedValueOnce(new Error("offline"));
    const onToast = jest.fn();
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    await register(h, { onToast });
    expect(onToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Approval notifications unavailable" })
    );
    expect(h.listeners.open).toBeDefined();
  });

  it("re-registers the token and reconciles on connection recovery", async () => {
    const h = createHarness();
    await register(h);
    h.shellClient.push.register.mockClear();
    h.listeners.recovery?.();
    await new Promise((resolve) => setImmediate(resolve));
    expect(h.shellClient.push.register).toHaveBeenCalledTimes(1);
    expect(h.shellClient.shellApproval.listPending).toHaveBeenCalledTimes(2);
  });

  it("routes opens and the launch open into the app callbacks", async () => {
    const h = createHarness();
    const payload = { ...scope, kind: "user-inbox", notificationId: "n1" };
    h.notifications.takeInitialOpen.mockResolvedValue({ kind: "approval", target });
    const onApprovalDeepLink = jest.fn();
    const onInboxDeepLink = jest.fn();
    await register(h, { onApprovalDeepLink, onInboxDeepLink });
    expect(onApprovalDeepLink).toHaveBeenCalledWith(target);
    h.listeners.open?.({ kind: "inbox", payload });
    expect(onInboxDeepLink).toHaveBeenCalledWith(payload);
  });

  it("cancels displayed notifications of this workspace whose approval is no longer pending", async () => {
    const h = createHarness();
    h.notifications.displayed.mockResolvedValue([
      { id: "kept", data: { ...target } },
      { id: "stale", data: { ...target, approvalId: "approval-2" } },
      { id: "other-workspace", data: { ...target, approvalId: "approval-3", workspaceId: "other" } },
      { id: "unrelated", data: {} },
    ]);
    await register(h);
    expect(h.notifications.cancel.mock.calls).toEqual([["stale"]]);
  });

  it("removes its subscriptions on cleanup", async () => {
    const h = createHarness();
    const cleanup = await register(h);
    const unsubscribe = h.notifications.onOpen.mock.results[0]?.value as jest.Mock;
    cleanup();
    expect(unsubscribe).toHaveBeenCalled();
  });
});
