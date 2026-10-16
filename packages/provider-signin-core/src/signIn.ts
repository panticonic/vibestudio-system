import type { PendingApproval } from "@vibestudio/shared/approvals";
import { HOST_APPROVAL_COPY } from "@vibestudio/shared/hostApprovalCopy";

/**
 * How a pending provider sign-in is answered. The server owns the OAuth
 * transaction end to end; a client's part is only to show the person what to do,
 * open the provider's page, and (when the provider cannot call back) take what
 * they paste. Three shapes exist:
 *
 * - `device-code`: type a short code on the provider's page; the host completes
 *   when the provider reports it (RFC 8628);
 * - `browser-callback`: sign in in a browser; the request closes by itself when
 *   the provider's callback arrives;
 * - `browser-paste`: sign in in a browser, then enter the requested fields
 *   (paste-back). The fields themselves are a protected input, typed only into
 *   trusted chrome (`@workspace/approvals-core`).
 */
export type SignInModel =
  | {
      kind: "device-code";
      approvalId: string;
      title: string;
      service: string;
      userCode: string;
      /** The page to open: the provider's pre-filled URL when it gave one. */
      verificationUrl: string;
      /** The page the code is typed on, as the provider names it. */
      verificationUri: string;
      /** Origin of the provider's token endpoint. */
      providerOrigin: string;
      expiresAt: number;
      enterCode: string;
      help: string;
    }
  | {
      kind: "browser-callback" | "browser-paste";
      approvalId: string;
      title: string;
      service: string;
      browser: "internal" | "external";
      instructions: string;
      /** The request closes by itself when the provider calls back; there is nothing to enter. */
      waitingForCallback: boolean;
    };

export type SignInApproval = Extract<PendingApproval, { kind: "device-code" | "credential-input" }>;

/** The sign-in an approval asks for, or `null` for an approval that is not one. */
export function signInModel(approval: PendingApproval | undefined): SignInModel | null {
  if (!approval) return null;
  if (approval.kind === "device-code") {
    return {
      kind: "device-code",
      approvalId: approval.approvalId,
      title: `Sign in to ${approval.credentialLabel}`,
      service: approval.credentialLabel,
      userCode: approval.userCode,
      verificationUrl: approval.verificationUriComplete ?? approval.verificationUri,
      verificationUri: approval.verificationUri,
      providerOrigin: approval.oauthTokenOrigin,
      expiresAt: approval.expiresAt,
      enterCode: HOST_APPROVAL_COPY.deviceSignIn.enterCode,
      help: HOST_APPROVAL_COPY.deviceSignIn.verificationHelp,
    };
  }
  if (approval.kind === "credential-input" && approval.browserSignIn) {
    const waitingForCallback = approval.browserSignIn.callbackExpected && approval.fields.length === 0;
    return {
      kind: waitingForCallback ? "browser-callback" : "browser-paste",
      approvalId: approval.approvalId,
      title: approval.title,
      service: approval.credentialLabel,
      browser: approval.browserSignIn.browser,
      instructions:
        approval.browserSignIn.instructions ??
        (approval.browserSignIn.callbackExpected
          ? "Complete sign-in in the browser; this request closes when its callback arrives."
          : "Complete sign-in in the browser, then enter the requested fields."),
      waitingForCallback,
    };
  }
  return null;
}

/** What the platform can do for a sign-in. */
export interface SignInPort {
  /** Open the provider's page in the person's browser. */
  openExternal(url: string): Promise<void>;
  /** Put text on the clipboard. */
  copyText(text: string): Promise<void>;
}

/** The two things a device-code sign-in lets a person do, as plain actions on the port. */
export function deviceCodeActions(
  model: Extract<SignInModel, { kind: "device-code" }>,
  port: SignInPort
): { open(): Promise<void>; copy(): Promise<void> } {
  return {
    open: () => port.openExternal(model.verificationUrl),
    copy: () => port.copyText(model.userCode),
  };
}

/** Whether the device code has run out; the server settles the approval, this only words the page. */
export function deviceCodeExpired(
  model: Extract<SignInModel, { kind: "device-code" }>,
  now: number
): boolean {
  return now >= model.expiresAt;
}
