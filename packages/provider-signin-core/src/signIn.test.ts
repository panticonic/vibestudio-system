import { describe, expect, it, vi } from "vitest";
import type { PendingApproval } from "@vibestudio/shared/approvals";
import { deviceCodeActions, deviceCodeExpired, signInModel } from "./signIn.js";

const base = {
  approvalId: "a1",
  callerId: "c",
  callerKind: "client" as const,
  repoPath: "meta",
  effectiveVersion: "",
  requestedAt: 1,
};

const deviceCode = {
  ...base,
  kind: "device-code",
  credentialLabel: "GitHub",
  userCode: "ABCD-1234",
  verificationUri: "https://github.com/login/device",
  expiresAt: 1000,
  oauthTokenOrigin: "https://github.com",
} as unknown as PendingApproval;

const credentialInput = (overrides: Record<string, unknown>) =>
  ({
    ...base,
    kind: "credential-input",
    title: "Connect account",
    credentialLabel: "Service",
    audience: [],
    scopes: [],
    fields: [],
    ...overrides,
  }) as unknown as PendingApproval;

describe("sign-in model", () => {
  it("opens the provider's pre-filled URL when it gave one, and copies the code", async () => {
    const model = signInModel({
      ...deviceCode,
      verificationUriComplete: "https://github.com/login/device?user_code=ABCD-1234",
    } as PendingApproval);
    if (model?.kind !== "device-code") throw new Error("expected a device-code model");
    const port = { openExternal: vi.fn(async () => undefined), copyText: vi.fn(async () => undefined) };
    const actions = deviceCodeActions(model, port);
    await actions.open();
    await actions.copy();
    expect(port.openExternal).toHaveBeenCalledWith("https://github.com/login/device?user_code=ABCD-1234");
    expect(port.copyText).toHaveBeenCalledWith("ABCD-1234");
    expect(model.title).toBe("Sign in to GitHub");
    expect(deviceCodeExpired(model, 999)).toBe(false);
    expect(deviceCodeExpired(model, 1000)).toBe(true);
  });

  it("falls back to the plain verification page without a pre-filled URL", () => {
    const model = signInModel(deviceCode);
    expect(model).toMatchObject({ kind: "device-code", verificationUrl: "https://github.com/login/device" });
  });

  it("waits for the provider's callback when no input is requested and says so", () => {
    const model = signInModel(
      credentialInput({ browserSignIn: { browser: "external", callbackExpected: true } })
    );
    expect(model).toMatchObject({ kind: "browser-callback", waitingForCallback: true });
    expect(model && "instructions" in model && model.instructions).toContain("callback arrives");
  });

  it("asks for paste-back when the provider cannot call back", () => {
    const model = signInModel(
      credentialInput({
        browserSignIn: { browser: "internal", callbackExpected: false, instructions: "Paste the code." },
        fields: [{ name: "code", label: "Code", required: true, type: "secret" }],
      })
    );
    expect(model).toMatchObject({ kind: "browser-paste", waitingForCallback: false, instructions: "Paste the code." });
  });

  it("is nothing for approvals that are not sign-ins", () => {
    expect(signInModel(credentialInput({}))).toBeNull();
    expect(signInModel(undefined)).toBeNull();
  });
});
