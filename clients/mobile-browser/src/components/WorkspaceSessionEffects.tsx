import { useEffect } from "react";
import { observeDurableProjection } from "@vibestudio/shell-core/durableObservation";
import type {
  MobileWorkspaceDirectory,
  MobileWorkspaceSession,
} from "../services/workspaceDirectory";
import { presentWorkspaceNotification } from "../services/workspaceNotifications";
import {
  handleExternalOpen,
  type ExternalOpenPayload,
} from "../services/oauthLoopback";
import { Alert } from "react-native";
import { presentClientUpdates } from "@workspace/client-kit-native";
import type { ClientUpdateModel } from "@workspace/client-update-core";
import { createMobileClientUpdateModel } from "../services/mobileClientUpdate";
import type { ToastInput } from "../state/toastAtoms";

/** Connected workspace events remain visible even before its panels are opened. */
export function WorkspaceSessionEffects({
  directory,
  session,
  notify,
  theme,
}: {
  directory: MobileWorkspaceDirectory;
  session: MobileWorkspaceSession;
  notify: (toast: ToastInput) => void;
  theme: "light" | "dark";
}) {
  useEffect(() => {
    void session.client.panels.updateTheme(theme).catch((error) => {
      console.warn("[WorkspaceSession] Failed to sync panel theme", error);
    });
  }, [session, theme]);

  useEffect(() => {
    const client = session.client;
    let active = true;
    const isAppSource = session.workspaceId === directory.systemWorkspaceId;
    const candidate = isAppSource
      ? client.hostLaunch.configuredCandidate("react-native")
      : Promise.resolve(null);
    void candidate.catch(() => undefined);
    const current = () =>
      active && directory.sessions.get(session.workspaceId) === session;
    // The update model is made when the selected client is first known and is
    // retired with this session; it asks once per ready build.
    let updates: { model: ClientUpdateModel; stop: () => void } | undefined;
    const updatesFor = (selected: { source: string; name: string }) => {
      if (updates) return updates.model;
      const model = createMobileClientUpdateModel({
        shellClient: client,
        selectedSource: selected.source,
        selectedClientId: selected.name,
      });
      updates = {
        model,
        stop: presentClientUpdates(model, {
          alert: Alert.alert,
          notify: (toast) => {
            if (current()) notify(toast);
          },
        }),
      };
      return model;
    };
    const stopAppLifecycle = isAppSource
      ? client.events.on("supervision:changed", (change) => {
          void candidate
            .then((selected) => {
              if (!current() || !selected) return;
              updatesFor(selected).handleChange(change);
            })
            .catch((error: unknown) => {
              if (current())
                console.warn(
                  "[WorkspaceSession] App lifecycle unavailable",
                  error,
                );
            });
        })
      : undefined;
    const present = (payload: unknown) => {
      if (!active || directory.sessions.get(session.workspaceId) !== session)
        return;
      const notification = payload as {
        id?: string;
        title?: string;
        message?: string;
        type?: string;
        consent?: {
          provider?: string;
          scopes?: string[];
          callerTitle?: string;
        };
      };
      const consent = notification.type === "consent" && notification.id;
      presentWorkspaceNotification(directory, notify, session.workspaceId, {
        id: notification.id,
        title:
          notification.title ??
          (consent ? "OAuth access requested" : "Vibestudio"),
        message: consent
          ? `${notification.consent?.callerTitle ?? "A panel"} wants to connect to ${notification.consent?.provider ?? "service"} (${notification.consent?.scopes?.join(", ") ?? "access"}).`
          : (notification.message ?? ""),
        tone: "info",
      });
    };
    const topics = [
      "notification:show",
      "external-open:open",
      ...(isAppSource ? ["supervision:changed" as const] : []),
    ] as const;
    const openExternal = (payload: ExternalOpenPayload) => {
      if (!active || directory.sessions.get(session.workspaceId) !== session)
        return;
      void handleExternalOpen(client, payload).catch((error: unknown) => {
        if (!active || directory.sessions.get(session.workspaceId) !== session)
          return;
        presentWorkspaceNotification(directory, notify, session.workspaceId, {
          title: "Could not open external link",
          message: error instanceof Error ? error.message : String(error),
          tone: "danger",
        });
      });
    };
    const observation = observeDurableProjection({
      listen: (invalidate) => {
        const stopExternal = client.events.on(
          "external-open:open",
          (payload) => {
            openExternal(payload);
            invalidate();
          },
        );
        const stopExternalDirect = client.onDirectEvent(
          "external-open:open",
          openExternal,
        );
        const stopEvent = client.events.on("notification:show", (payload) => {
          present(payload);
          invalidate();
        });
        const stopDirect = client.onDirectEvent("notification:show", present);
        return () => {
          stopExternal();
          stopExternalDirect();
          stopEvent();
          stopDirect();
        };
      },
      admit: () => client.events.subscribeAll(topics),
      leave: () => client.events.unsubscribeMany(topics),
      read: async () => undefined,
      apply: () => undefined,
      error: (error) =>
        console.warn("[WorkspaceNotifications] Observation failed", error),
    });
    return () => {
      active = false;
      stopAppLifecycle?.();
      updates?.stop();
      void observation
        .stop()
        .catch((error: unknown) =>
          console.warn("[WorkspaceNotifications] Retirement failed", error),
        );
    };
  }, [directory, session, notify]);
  return null;
}
