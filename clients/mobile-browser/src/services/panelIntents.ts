import type { ClientIntent, RnClientApi } from "@vibestudio/rn-client-api";

/** The manifest's intent for opening a panel link (`params.panel` is the raw link). */
export const OPEN_PANEL_INTENT = "open-panel";

/** The raw panel link an intent asks to open, or `null` for any other intent. */
export function panelLinkOfIntent(intent: ClientIntent): string | null {
  if (intent.name !== OPEN_PANEL_INTENT) return null;
  const panel = intent.params["panel"];
  return typeof panel === "string" && panel.length > 0 ? panel : null;
}

/**
 * Deliver every panel link this instance is asked to open: the one it was
 * launched with, then each later one. Returns the retirement function.
 */
export function observePanelLinks(
  api: RnClientApi,
  onLink: (rawLink: string) => void,
): () => void {
  const deliver = (intent: ClientIntent) => {
    const link = panelLinkOfIntent(intent);
    if (link) onLink(link);
  };
  if (api.intent.initial) deliver(api.intent.initial);
  return api.intent.onIntent(deliver);
}
