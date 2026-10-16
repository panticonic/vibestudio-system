import { describe, expect, it, vi } from "vitest";
import {
  createCallbackDeduper,
  createOAuthCallbackForwarder,
  parseOAuthCallbackUrl,
} from "./oauthCallback.js";

const HOST = "vibestudio.app";

describe("oauth callback parsing", () => {
  it("accepts universal-link callbacks keyed by transactionId", () => {
    const url = "https://vibestudio.app/oauth/callback/tx-abc123?code=code-1&state=state-1";
    expect(parseOAuthCallbackUrl(url, HOST)).toEqual({
      transactionId: "tx-abc123",
      code: "code-1",
      state: "state-1",
      rawUrl: url,
    });
  });

  it("rejects custom-scheme callbacks, other hosts, other paths and malformed escapes", () => {
    expect(parseOAuthCallbackUrl("vibestudio://oauth/callback/x?code=c&state=s", HOST)).toBeNull();
    expect(parseOAuthCallbackUrl("https://evil.example/oauth/callback/x?code=c&state=s", HOST)).toBeNull();
    expect(parseOAuthCallbackUrl("https://vibestudio.app/connect?code=c&state=s", HOST)).toBeNull();
    expect(parseOAuthCallbackUrl("https://vibestudio.app/oauth/callback/x?code=%E0%A4%A&state=s", HOST)).toBeNull();
    expect(parseOAuthCallbackUrl("https://vibestudio.app/oauth/callback/a/b?code=c&state=s", HOST)).toBeNull();
  });

  it("carries a provider rejection to the server as an empty code, so the pending flow fails instead of hanging", () => {
    const url = "https://vibestudio.app/oauth/callback/tx?error=access_denied&state=s";
    expect(parseOAuthCallbackUrl(url, HOST)).toMatchObject({ code: "", state: "s" });
    expect(parseOAuthCallbackUrl("https://vibestudio.app/oauth/callback/tx?error=access_denied", HOST)).toBeNull();
  });
});

describe("callback deduper and forwarder", () => {
  it("forgets a state after the dedupe window and evicts the oldest at capacity", () => {
    let now = 0;
    const deduper = createCallbackDeduper(() => now);
    deduper.remember("a");
    expect(deduper.has("a")).toBe(true);
    now = 5 * 60 * 1000 + 1;
    expect(deduper.has("a")).toBe(false);
    now = 0;
    for (let i = 0; i < 33; i++) deduper.remember(`s${i}`);
    expect(deduper.has("s0")).toBe(false);
    expect(deduper.has("s32")).toBe(true);
  });

  it("forwards once per state, ignores other links, and lets a failed hand-off be retried", async () => {
    const forward = vi.fn<(callback: unknown) => Promise<void>>(async () => undefined);
    const handle = createOAuthCallbackForwarder({ universalLinkHost: HOST, port: { forward } });
    const url = "https://vibestudio.app/oauth/callback/tx?code=c&state=s";
    expect(await handle(null)).toBe("ignored");
    expect(await handle("https://vibestudio.app/connect")).toBe("ignored");
    expect(await handle(url)).toBe("forwarded");
    expect(await handle(url)).toBe("duplicate");
    expect(forward).toHaveBeenCalledTimes(1);
    expect(forward).toHaveBeenCalledWith({ transactionId: "tx", url, state: "s", code: "c" });

    forward.mockRejectedValueOnce(new Error("offline"));
    const other = "https://vibestudio.app/oauth/callback/tx2?code=c2&state=s2";
    await expect(handle(other)).rejects.toThrow("offline");
    expect(await handle(other)).toBe("forwarded");
  });
});
