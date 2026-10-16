/**
 * Mobile OAuth deep-link wiring.
 *
 * The OAuth flows on mobile (Codex login, credential providers) open the system
 * browser to the provider's authorize URL with `redirect_uri` pointing back at
 * the app-identity-bound universal link / Android App Link:
 *
 *   https://vibestudio.app/oauth/callback/<transactionId>?code=…&state=…
 *
 * The OS only delivers these to this app once the AASA / assetlinks.json
 * verification (served by the apex apps/webhook-relay Worker) has bound the host
 * to our team-id + signing cert. Another app claiming the same host cannot
 * intercept.
 *
 * What a callback means, which links count, and the once-per-state hand-off to
 * the server are `@workspace/provider-signin-core`'s; this file only connects
 * React Native's `Linking` to it and the shell client's server connection.
 */
import { Linking, type EmitterSubscription } from "react-native";
import { createOAuthCallbackForwarder } from "@workspace/provider-signin-core";
import type { ShellClient } from "./shellClient";

const UNIVERSAL_LINK_HOST = "vibestudio.app";

/**
 * Wire the OAuth deep-link listener for the lifetime of a `ShellClient`
 * session. Called from App.tsx once the shell client is available; the returned
 * cleanup detaches the listener on unmount / sign-out.
 *
 * The callback delivery is authenticated by the AASA-bound app identity, but the
 * code exchange is shell-mediated: the callback is forwarded to the server
 * (`credentials.forwardOAuthCallback`), which owns the pending OAuth transaction
 * and completes the exchange.
 */
export function setupOAuthHandler(shellClient: ShellClient): () => void {
  const forward = createOAuthCallbackForwarder({
    universalLinkHost: UNIVERSAL_LINK_HOST,
    port: {
      forward: (callback) => shellClient.credentialService.forwardOAuthCallback(callback),
    },
  });
  const handleUrl = (url: string | null) => {
    forward(url).catch((err: unknown) => {
      console.warn("[oauthHandler] Failed to forward OAuth callback:", err);
    });
  };
  // Cold-start path: if the OS launched the app *because* of a deep link,
  // `getInitialURL` returns it once. Subsequent foreground re-deliveries arrive
  // via the `url` event.
  void Linking.getInitialURL()
    .then(handleUrl)
    .catch((err: unknown) => {
      console.warn("[oauthHandler] getInitialURL failed", err);
    });
  let subscription: EmitterSubscription | null = Linking.addEventListener(
    "url",
    ({ url }: { url: string }) => handleUrl(url)
  );
  return () => {
    if (subscription) {
      subscription.remove();
      subscription = null;
    }
  };
}
