import { createFakeClientHost } from "@workspace/client-kit-native/testing";
import {
  observePanelLinks,
  OPEN_PANEL_INTENT,
  panelLinkOfIntent,
} from "./panelIntents";

const LINK = "vibestudio://panel?source=panels%2Fchat";

describe("panel intents", () => {
  it("reads the raw link of an open-panel intent and nothing else", () => {
    expect(panelLinkOfIntent({ name: OPEN_PANEL_INTENT, params: { panel: LINK } })).toBe(LINK);
    expect(panelLinkOfIntent({ name: OPEN_PANEL_INTENT, params: {} })).toBeNull();
    expect(panelLinkOfIntent({ name: OPEN_PANEL_INTENT, params: { panel: "" } })).toBeNull();
    expect(panelLinkOfIntent({ name: "share", params: { panel: LINK } })).toBeNull();
  });

  it("delivers the launch intent, then each later intent, until retired", async () => {
    const fake = await createFakeClientHost({
      intent: { name: OPEN_PANEL_INTENT, params: { panel: LINK } },
    });
    const links: string[] = [];
    const stop = observePanelLinks(fake.api, (link) => links.push(link));
    expect(links).toEqual([LINK]);

    fake.emit({ type: "intent", intent: { name: OPEN_PANEL_INTENT, params: { panel: "second" } } });
    fake.emit({ type: "intent", intent: { name: "other", params: { panel: "ignored" } } });
    expect(links).toEqual([LINK, "second"]);

    stop();
    fake.emit({ type: "intent", intent: { name: OPEN_PANEL_INTENT, params: { panel: "third" } } });
    expect(links).toEqual([LINK, "second"]);
  });

  it("has nothing to deliver when launched without an intent", async () => {
    const fake = await createFakeClientHost({ intent: null });
    const links: string[] = [];
    observePanelLinks(fake.api, (link) => links.push(link));
    expect(links).toEqual([]);
  });
});
