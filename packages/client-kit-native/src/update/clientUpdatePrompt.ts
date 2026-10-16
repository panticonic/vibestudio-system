import type { Alert } from "react-native";
import {
  clientUpdateMessage,
  type ClientUpdateModel,
  type ClientUpdateNotice,
} from "@workspace/client-update-core";

/** How a prompt reaches the person: the platform's alert and the host's toast. */
export interface ClientUpdatePresentation {
  alert: typeof Alert.alert;
  notify(toast: {
    title: string;
    message: string;
    tone: "danger" | "success" | "info";
    durationMs?: number;
  }): void;
}

/**
 * Present a client update model's state: ask once per ready build whether to
 * install it (later, roll back, or install), and say plainly when an update was
 * refused, failed or rolled back. The model decides what is pending and what
 * happened; this only words it. Returns the retirement function.
 */
export function presentClientUpdates(
  model: ClientUpdateModel,
  { alert, notify }: ClientUpdatePresentation
): () => void {
  const asked = new Set<string>();
  const told = new Set<string>();
  // An apply or rollback failure is already a notice on the model, and it is
  // told below; the rejection has nowhere further to go from a button.
  const settle = (operation: Promise<void>) => void operation.catch(() => undefined);
  const present = () => {
    const state = model.getSnapshot();
    for (const update of state.pending) {
      const key = `${update.clientId}:${update.buildKey ?? "unknown"}`;
      if (asked.has(key)) continue;
      asked.add(key);
      alert("Mobile app update available", clientUpdateMessage(update), [
        { text: "Later", style: "cancel", onPress: () => model.postpone(update.clientId) },
        ...(update.canRollback
          ? [
              {
                text: "Roll back",
                style: "destructive" as const,
                onPress: () => settle(model.rollback(update.clientId)),
              },
            ]
          : []),
        { text: "Install", onPress: () => settle(model.apply(update.clientId)) },
      ]);
    }
    for (const notice of state.notices) {
      if (told.has(notice.id)) continue;
      told.add(notice.id);
      notify(toastOf(notice));
      model.dismissNotice(notice.id);
    }
  };
  const stop = model.subscribe(present);
  present();
  return stop;
}

function toastOf(notice: ClientUpdateNotice) {
  return {
    title: notice.title,
    message: notice.message,
    tone: notice.tone,
    ...(notice.tone === "danger" ? { durationMs: 10_000 } : {}),
  };
}
