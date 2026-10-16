import { installClientApi } from "@workspace/client-kit-native/host";
import { createFakeClientHost } from "@workspace/client-kit-native/testing";
import { loadPinnedPanelIds, savePinnedPanelIds } from "./pinnedPanels";

// The host's client state is the store; a fresh fake host round-trips in memory.
let host: Awaited<ReturnType<typeof createFakeClientHost>>;
beforeEach(async () => {
  host = await createFakeClientHost();
  installClientApi(host.api);
});

describe("pinnedPanels store", () => {
  it("round-trips pinned ids across save/load", async () => {
    await savePinnedPanelIds("account-a", "ws1", [
      "panel:tree/a",
      "panel:tree/b",
    ]);
    const loaded = await loadPinnedPanelIds("account-a", "ws1");
    expect(loaded).toEqual(["panel:tree/a", "panel:tree/b"]);
  });

  it("scopes pins per workspace", async () => {
    await savePinnedPanelIds("account-a", "ws1", ["panel:tree/a"]);
    await savePinnedPanelIds("account-a", "ws2", ["panel:tree/z"]);
    expect(await loadPinnedPanelIds("account-a", "ws1")).toEqual([
      "panel:tree/a",
    ]);
    expect(await loadPinnedPanelIds("account-a", "ws2")).toEqual([
      "panel:tree/z",
    ]);
  });

  it("does not inherit another account's pins in a shared workspace", async () => {
    await savePinnedPanelIds("account-a", "shared", ["private-panel"]);
    expect(await loadPinnedPanelIds("account-b", "shared")).toEqual([]);
  });

  it("returns [] for an unknown workspace", async () => {
    expect(await loadPinnedPanelIds("account-a", "missing")).toEqual([]);
  });

  it("ignores malformed persisted data", async () => {
    host.state.set(
      "vibestudio:account:account-a:workspace:wsX:pinned-panels",
      "{not json",
    );
    expect(await loadPinnedPanelIds("account-a", "wsX")).toEqual([]);
  });
});
