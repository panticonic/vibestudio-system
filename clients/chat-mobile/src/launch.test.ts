import { applyIntent, initialLaunch } from "./launch";

describe("chat launch", () => {
  it("resumes the last conversation when entered without an intent", () => {
    expect(initialLaunch(null, "chan-1")).toEqual({ generation: 0, channelName: "chan-1", initialInput: null });
    expect(initialLaunch(null, null)).toEqual({ generation: 0, channelName: null, initialInput: null });
  });

  it("opens the conversation an open-conversation intent names, even over the same one", () => {
    const first = initialLaunch({ name: "open-conversation", params: { conversation: "chan-2" } }, "chan-1");
    expect(first).toEqual({ generation: 1, channelName: "chan-2", initialInput: null });
    const again = applyIntent(first, { name: "open-conversation", params: { conversation: "chan-2" } });
    expect(again.generation).toBe(2);
    expect(again.channelName).toBe("chan-2");
  });

  it("starts a new chat with the text a share delivers in its composer", () => {
    const launch = applyIntent(initialLaunch(null, "chan-1"), {
      name: "share",
      params: { text: "look at this" },
    });
    expect(launch).toEqual({ generation: 1, channelName: null, initialInput: "look at this" });
  });

  it("ignores an intent that names nothing to show, and the implicit open", () => {
    const base = initialLaunch(null, "chan-1");
    expect(applyIntent(base, { name: "open-conversation", params: {} })).toBe(base);
    expect(applyIntent(base, { name: "share", params: {} })).toBe(base);
    expect(applyIntent(base, { name: "open", params: {} })).toBe(base);
    expect(applyIntent(base, null)).toBe(base);
  });
});
