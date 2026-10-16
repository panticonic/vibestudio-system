/**
 * The client half of push (docs/client-hosts-and-clients-plan.md 4.1, 5.3).
 *
 * The host runtime owns the device: permission, the FCM/APNs token, displaying
 * pushes, lock-screen decisions. This client only tells each workspace which
 * device token to push approvals and messages to, navigates when the person
 * opens a notification, and cancels notifications whose approvals are gone.
 */
import { AppState, type AppStateStatus } from "react-native";
import type {
  NotificationOpen,
  RnClientApi,
} from "@vibestudio/rn-client-api";
import {
  readWorkspacePushScope,
  sameWorkspacePushScope,
  type WorkspaceApprovalTarget,
} from "@vibestudio/shared/workspacePushScope";
import type { PushUserInboxDataPayload } from "@vibestudio/shared/userNotifications";
import type { ShellClient } from "./shellClient";

const PERMISSION_DENIED_TOAST_KEY = "vibestudio:push:permission-denied-toast-at";
const PERMISSION_DENIED_TOAST_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

export interface PushRuntimeCallbacks {
  onApprovalDeepLink?: (target: WorkspaceApprovalTarget) => void;
  /**
   * A tapped inbox push (messaging plan §4.5 step 5 / §4.10.9): land the person
   * on the escalated envelope — the conversation sheet on the phone — and
   * acknowledge the entry the way any other surface would.
   */
  onInboxDeepLink?: (payload: PushUserInboxDataPayload) => void;
  onToast?: (toast: {
    title?: string;
    message: string;
    tone?: "info" | "success" | "warning" | "danger";
    durationMs?: number;
  }) => void;
}

type PushApi = Pick<RnClientApi, "notifications" | "state">;

function readApprovalTarget(value: unknown): WorkspaceApprovalTarget | null {
  const scope = readWorkspacePushScope(value);
  if (!scope) return null;
  const approvalId = (value as Record<string, unknown>)["approvalId"];
  return typeof approvalId === "string" && approvalId.trim() ? { ...scope, approvalId } : null;
}

async function maybeShowDeniedToast(api: PushApi, callbacks: PushRuntimeCallbacks): Promise<void> {
  const now = Date.now();
  const lastShown = Number((await api.state.get(PERMISSION_DENIED_TOAST_KEY)) ?? 0);
  if (lastShown && now - lastShown < PERMISSION_DENIED_TOAST_INTERVAL_MS) return;
  callbacks.onToast?.({
    title: "Notifications are off",
    message: "Enable notifications in system settings to approve requests from the lock screen.",
    tone: "warning",
    durationMs: 8000,
  });
  await api.state.set(PERMISSION_DENIED_TOAST_KEY, String(now));
}

/** Cancel displayed approval notifications of this workspace whose approval is no longer pending. */
async function reconcileDisplayed(api: PushApi, shellClient: ShellClient): Promise<void> {
  const scope = shellClient.pushScope;
  if (!scope) return;
  const pendingIds = new Set(
    (await shellClient.shellApproval.listPending()).map((approval) => approval.approvalId)
  );
  for (const entry of await api.notifications.displayed()) {
    // Notifications are displayed under `cancelKey ?? approvalId`, but the
    // approval identity lives in the payload: match on the carried approvalId
    // and cancel by the actual display id.
    const target = readApprovalTarget(entry.data);
    if (target && sameWorkspacePushScope(target, scope) && !pendingIds.has(target.approvalId)) {
      await api.notifications.cancel(entry.id);
    }
  }
}

/**
 * Register this device for push with `shellClient`'s workspace and wire the
 * notification surface into the app. Call after the ShellClient is connected
 * and authenticated; the returned function removes every subscription.
 */
export async function registerForPushNotifications(
  api: PushApi,
  shellClient: ShellClient,
  callbacks: PushRuntimeCallbacks = {}
): Promise<() => void> {
  const { notifications } = api;
  const cleanups: Array<() => void> = [];
  const cleanup = () => {
    for (const fn of cleanups.splice(0)) fn();
  };
  const report = (what: string) => (error: unknown) =>
    console.error(`[PushRegistration] Failed to ${what}:`, error);

  let status = await notifications.status();
  if (!status.configured) {
    console.info("[PushRegistration] Firebase is not configured. Push disabled.");
    return cleanup;
  }
  if (status.permission !== "granted") {
    if (!(await notifications.requestPermission())) {
      await maybeShowDeniedToast(api, callbacks);
      return cleanup;
    }
    status = await notifications.status();
  }

  const register = async (token: string): Promise<void> => {
    await shellClient.push.register({
      token,
      platform: status.platform,
      clientId: status.deviceClientId,
    });
  };

  if (status.token) {
    try {
      await register(status.token);
    } catch (error) {
      console.error("[PushRegistration] Failed to register token:", error);
      callbacks.onToast?.({
        title: "Approval notifications unavailable",
        message:
          "This device could not register for remote approval alerts. It will retry when the connection recovers.",
        tone: "warning",
        durationMs: 8000,
      });
    }
  }

  const route = (open: NotificationOpen) => {
    if (open.kind === "inbox") callbacks.onInboxDeepLink?.(open.payload);
    else callbacks.onApprovalDeepLink?.(open.target);
  };
  const takeOpen = () =>
    notifications
      .takeInitialOpen()
      .then((open) => open && route(open))
      .catch(report("read the launch notification"));
  const reconcile = () =>
    reconcileDisplayed(api, shellClient).catch(report("reconcile displayed notifications"));

  cleanups.push(
    notifications.onTokenChange((token) => void register(token).catch(report("register refreshed token"))),
    notifications.onOpen(route)
  );
  const appState = AppState.addEventListener("change", (next: AppStateStatus) => {
    if (next !== "active") return;
    void takeOpen();
    void reconcile();
  });
  cleanups.push(() => appState.remove());
  // Both recovered session kinds arrive through one recovery signal.
  cleanups.push(
    shellClient.transport.onRecovery(() => {
      void notifications
        .status()
        .then(async (current) => {
          if (current.token) await register(current.token);
        })
        .catch((error) => {
          console.error("[PushRegistration] Failed to re-register token after recovery:", error);
          callbacks.onToast?.({
            title: "Approval notifications still unavailable",
            message: "Keep Vibestudio open to see approval requests, or reconnect and try again.",
            tone: "warning",
            durationMs: 8000,
          });
        });
      void reconcile();
    })
  );

  await takeOpen();
  await reconcile();
  return cleanup;
}
