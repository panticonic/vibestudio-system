import { BrowserPrivacyPresentationState } from "./browserPrivacyPresentation";

describe("BrowserPrivacyPresentationState", () => {
  it("delivers an open received before the trusted shell screen subscribes", async () => {
    const state = new BrowserPrivacyPresentationState();
    const listener = jest.fn();

    const presented = state.accept("siteData");
    state.subscribe(listener);

    expect(listener).toHaveBeenCalledWith("siteData");
    await expect(presented).resolves.toBeUndefined();
  });

  it("delivers later opens to the active trusted shell presentation", async () => {
    const state = new BrowserPrivacyPresentationState();
    const listener = jest.fn();
    const unsubscribe = state.subscribe(listener);

    const presented = state.accept("autofill");
    unsubscribe();
    const pending = state.accept("siteData");

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith("autofill");
    await expect(presented).resolves.toBeUndefined();
    state.subscribe(jest.fn());
    await expect(pending).resolves.toBeUndefined();
  });

  it("acknowledges a second open while the manager is already visible", async () => {
    const state = new BrowserPrivacyPresentationState();
    const listener = jest.fn();
    state.subscribe(listener);

    await expect(state.accept("passwords")).resolves.toBeUndefined();
    await expect(state.accept("siteData")).resolves.toBeUndefined();

    expect(listener).toHaveBeenNthCalledWith(1, "passwords");
    expect(listener).toHaveBeenNthCalledWith(2, "siteData");
  });

  it("rejects obsolete navigation sections", async () => {
    const state = new BrowserPrivacyPresentationState();
    for (const section of [
      "credentials",
      "formFill",
      "inspect",
      "debug",
      "export",
    ]) {
      expect(() => state.accept(section)).toThrow();
    }
  });
});
