import { Linking } from "react-native";
import { setupOAuthHandler } from "./oauthHandler";
import type { ShellClient } from "./shellClient";

const CALLBACK = "https://vibestudio.app/oauth/callback/tx-1?code=abc&state=st-1";

function setup(initialUrl: string | null = null) {
  const forwardOAuthCallback = jest.fn(async () => undefined);
  const shellClient = {
    credentialService: { forwardOAuthCallback },
  } as unknown as ShellClient;
  let deliver!: (event: { url: string }) => void;
  const remove = jest.fn();
  jest.spyOn(Linking, "getInitialURL").mockResolvedValue(initialUrl);
  jest.spyOn(Linking, "addEventListener").mockImplementation(((
    _type: string,
    listener: (event: { url: string }) => void,
  ) => {
    deliver = listener;
    return { remove };
  }) as never);
  const stop = setupOAuthHandler(shellClient);
  return { forwardOAuthCallback, deliver: (url: string) => deliver({ url }), remove, stop };
}

afterEach(() => jest.restoreAllMocks());

describe("setupOAuthHandler", () => {
  it("forwards a callback delivered while running to the server, keyed by its transaction", async () => {
    const f = setup();
    f.deliver(CALLBACK);
    await Promise.resolve();
    expect(f.forwardOAuthCallback).toHaveBeenCalledWith({
      transactionId: "tx-1",
      url: CALLBACK,
      state: "st-1",
      code: "abc",
    });
  });

  it("forwards the link that launched the app, once, even when it is also delivered as an event", async () => {
    const f = setup(CALLBACK);
    await new Promise((resolve) => setTimeout(resolve, 0));
    f.deliver(CALLBACK);
    await Promise.resolve();
    expect(f.forwardOAuthCallback).toHaveBeenCalledTimes(1);
  });

  it("leaves other links to other handlers", async () => {
    const f = setup();
    f.deliver("https://vibestudio.app/connect?x=1");
    f.deliver("vibestudio://oauth/callback/tx-1?code=abc&state=st-1");
    await Promise.resolve();
    expect(f.forwardOAuthCallback).not.toHaveBeenCalled();
  });

  it("detaches its listener when retired", () => {
    const f = setup();
    f.stop();
    expect(f.remove).toHaveBeenCalledTimes(1);
  });
});
