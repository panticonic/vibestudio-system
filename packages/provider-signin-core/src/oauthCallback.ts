/**
 * OAuth deep-link hand-off for platforms whose browser returns to the app by a
 * universal link (`https://<host>/oauth/callback/<transactionId>?code=&state=`).
 *
 * The server owns the OAuth transaction end to end and blocks awaiting this
 * callback; the client only forwards it, keyed by the transaction, so the server
 * can match the pending transaction, exchange the code and resolve. The `state`
 * is PKCE-bound and unguessable, so a callback that was not started by this
 * account cannot name a live transaction.
 */

const OAUTH_PATH_PREFIX = "/oauth/callback/";
const DEDUPE_WINDOW_MS = 5 * 60 * 1000;
const DEDUPE_MAX_ENTRIES = 32;

export interface OAuthCallback {
  /** The pending OAuth transaction id: the trailing path segment of the relay URL. */
  transactionId: string;
  /** Empty when the provider rejected the flow (the server still has to fail the pending transaction). */
  code: string;
  state: string;
  rawUrl: string;
}

/**
 * The callback a URL carries, or `null` for any other link (so another deep-link
 * handler can see it). Only `https://<host>/oauth/callback/<transactionId>` is
 * accepted, and a malformed escape makes the whole URL untrusted.
 */
export function parseOAuthCallbackUrl(rawUrl: string, universalLinkHost: string): OAuthCallback | null {
  if (!rawUrl.startsWith("https://")) return null;
  const noScheme = rawUrl.slice("https://".length);
  const slash = noScheme.indexOf("/");
  const host = slash >= 0 ? noScheme.slice(0, slash) : noScheme;
  if (host.toLowerCase() !== universalLinkHost.toLowerCase()) return null;
  const pathAndQuery = slash >= 0 ? noScheme.slice(slash) : "/";
  const queryStart = pathAndQuery.indexOf("?");
  const path = queryStart >= 0 ? pathAndQuery.slice(0, queryStart) : pathAndQuery;
  const query = queryStart >= 0 ? pathAndQuery.slice(queryStart + 1) : "";
  if (!path.startsWith(OAUTH_PATH_PREFIX)) return null;
  const transactionId = path.slice(OAUTH_PATH_PREFIX.length).replace(/\/+$/, "");
  if (!transactionId || transactionId.includes("/")) return null;
  const params = new Map<string, string>();
  for (const piece of query.split("&")) {
    if (!piece) continue;
    const eq = piece.indexOf("=");
    const key = eq >= 0 ? piece.slice(0, eq) : piece;
    const value = eq >= 0 ? piece.slice(eq + 1) : "";
    try {
      params.set(decodeURIComponent(key), decodeURIComponent(value));
    } catch {
      return null;
    }
  }
  const code = params.get("code");
  const state = params.get("state");
  if (params.get("error")) return state ? { transactionId, code: "", state, rawUrl } : null;
  if (!code || !state) return null;
  return { transactionId, code, state, rawUrl };
}

/**
 * Remembers which states were already forwarded, because the OS sometimes
 * delivers one URL twice (cold start, then a `url` event). Bounded by count and
 * age so a long-running app cannot grow it without limit.
 */
export function createCallbackDeduper(now: () => number = Date.now): {
  has(state: string): boolean;
  remember(state: string): void;
  forget(state: string): void;
} {
  const seen = new Map<string, number>();
  return {
    has(state) {
      const at = seen.get(state);
      if (at === undefined) return false;
      if (now() - at > DEDUPE_WINDOW_MS) {
        seen.delete(state);
        return false;
      }
      return true;
    },
    remember(state) {
      const at = now();
      if (seen.size >= DEDUPE_MAX_ENTRIES) {
        for (const [key, rememberedAt] of seen) {
          if (at - rememberedAt > DEDUPE_WINDOW_MS) seen.delete(key);
          if (seen.size < DEDUPE_MAX_ENTRIES) break;
        }
        if (seen.size >= DEDUPE_MAX_ENTRIES) {
          const oldest = seen.keys().next().value;
          if (oldest !== undefined) seen.delete(oldest);
        }
      }
      seen.set(state, at);
    },
    forget(state) {
      seen.delete(state);
    },
  };
}

/** What a platform has to provide to hand a callback to the server. */
export interface OAuthCallbackPort {
  forward(callback: { transactionId: string; url: string; state: string; code?: string }): Promise<void>;
}

/**
 * Forward a link to the server when it is an OAuth callback, once per state. A
 * failed hand-off is forgotten so a redelivery can try again, and is returned to
 * the caller (never swallowed). Resolves `"ignored"` for any other link,
 * `"duplicate"` for a redelivery, `"forwarded"` otherwise.
 */
export function createOAuthCallbackForwarder(input: {
  universalLinkHost: string;
  port: OAuthCallbackPort;
  now?: () => number;
}): (rawUrl: string | null) => Promise<"ignored" | "duplicate" | "forwarded"> {
  const deduper = createCallbackDeduper(input.now);
  return async (rawUrl) => {
    if (!rawUrl) return "ignored";
    const parsed = parseOAuthCallbackUrl(rawUrl, input.universalLinkHost);
    if (!parsed) return "ignored";
    if (deduper.has(parsed.state)) return "duplicate";
    deduper.remember(parsed.state);
    try {
      await input.port.forward({
        transactionId: parsed.transactionId,
        url: parsed.rawUrl,
        state: parsed.state,
        ...(parsed.code ? { code: parsed.code } : {}),
      });
    } catch (error) {
      deduper.forget(parsed.state);
      throw error;
    }
    return "forwarded";
  };
}
