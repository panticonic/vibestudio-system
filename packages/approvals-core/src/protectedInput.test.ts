import { describe, expect, it, vi } from "vitest";
import {
  editProtectedInput,
  isProtectedApproval,
  newProtectedInput,
  submitProtectedInput,
  waitsForProviderCallback,
  type ProtectedApproval,
} from "./protectedInput.js";

const approval = {
  kind: "secret-input",
  fields: [
    { name: "token", label: "Token", type: "secret", required: true },
    {
      name: "mode",
      label: "Mode",
      type: "select",
      required: true,
      options: [
        { id: "one", label: "First" },
        { id: "two", label: "Second" },
      ],
    },
  ],
} as ProtectedApproval;
const key = (name: string) => ({ kind: "key" as const, name, seq: name });
describe("protected input", () => {
  it("waits for a browser callback instead of submitting an empty OAuth form", () => {
    const waiting: ProtectedApproval = {
      kind: "credential-input",
      approvalId: "oauth",
      callerId: "person",
      callerKind: "client",
      repoPath: "meta",
      effectiveVersion: "",
      requestedAt: 1,
      title: "Connect account",
      credentialLabel: "Service",
      audience: [],
      injection: { type: "header", name: "Authorization", valueTemplate: "Bearer {{token}}" },
      accountIdentity: { providerUserId: "" },
      scopes: [],
      fields: [],
      browserSignIn: { browser: "external", callbackExpected: true },
    };
    const state = newProtectedInput();
    expect(editProtectedInput(waiting, state, key("enter"))).toBeNull();
    expect(editProtectedInput(waiting, state, key("escape"))).toBe("cancel");
  });
  it("edits pasted Unicode, removes complete graphemes, and submits exact selected ids", () => {
    const state = newProtectedInput();
    editProtectedInput(approval, state, { kind: "paste", text: "secret👩‍💻" });
    editProtectedInput(approval, state, key("backspace"));
    expect(state.values["token"]).toBe("secret");
    editProtectedInput(approval, state, key("tab"));
    editProtectedInput(approval, state, key("right"));
    expect(state.values["mode"]).toBe("one");
    editProtectedInput(approval, state, key("enter"));
    expect(editProtectedInput(approval, state, key("enter"))).toBe("submit");
  });
  it("validates required inputs and refuses edits during a pending submission", () => {
    const state = newProtectedInput();
    state.field = approval.fields.length;
    expect(editProtectedInput(approval, state, key("enter"))).toBeNull();
    expect(state.error).toBe("Token is required");
    state.submitting = true;
    editProtectedInput(approval, state, {
      kind: "paste",
      text: "not admitted",
    });
    expect(state.values).toEqual({});
  });

  it("gates only the three input kinds", () => {
    expect(isProtectedApproval(approval)).toBe(true);
    expect(isProtectedApproval({ kind: "client-config" } as ProtectedApproval)).toBe(true);
    expect(isProtectedApproval({ kind: "credential-input" } as ProtectedApproval)).toBe(true);
    expect(isProtectedApproval({ kind: "capability" } as never)).toBe(false);
    expect(isProtectedApproval(undefined)).toBe(false);
  });

  it("keeps entered values in the state it was given and never anywhere else", () => {
    const state = newProtectedInput();
    const other = newProtectedInput();
    editProtectedInput(approval, state, { kind: "paste", text: "hunter2" });
    expect(state.values).toEqual({ token: "hunter2" });
    expect(other.values).toEqual({});
  });

  it("cancels on escape even while a submission is pending", () => {
    const state = newProtectedInput();
    state.submitting = true;
    expect(editProtectedInput(approval, state, key("escape"))).toBe("cancel");
  });

  it("recognises a sign-in that completes by itself", () => {
    expect(
      waitsForProviderCallback({
        kind: "credential-input",
        fields: [],
        browserSignIn: { browser: "external", callbackExpected: true },
      } as unknown as ProtectedApproval)
    ).toBe(true);
    expect(waitsForProviderCallback(approval)).toBe(false);
  });
});

describe("protected submission", () => {
  const client = () => ({
    submitClientConfig: vi.fn(async () => undefined),
    submitCredentialInput: vi.fn(async () => undefined),
    submitSecretInput: vi.fn(async () => undefined),
  });

  it.each([
    ["client-config", "submitClientConfig"],
    ["credential-input", "submitCredentialInput"],
    ["secret-input", "submitSecretInput"],
  ] as const)("sends a %s only through its own typed method, and clears the values", async (kind, method) => {
    const target = { ...approval, kind, approvalId: "p1" } as ProtectedApproval;
    const typed = client();
    const state = newProtectedInput();
    state.values = { token: "s3cret" };
    await submitProtectedInput(typed, target, state);
    for (const name of Object.keys(typed) as Array<keyof typeof typed>) {
      expect(typed[name]).toHaveBeenCalledTimes(name === method ? 1 : 0);
    }
    expect(typed[method]).toHaveBeenCalledWith("p1", { token: "s3cret" });
    expect(state.values).toEqual({});
    expect(state.submitting).toBe(true);
  });

  it("keeps the values for a retry when the host refuses, and reports the failure to the caller", async () => {
    const typed = client();
    typed.submitSecretInput.mockRejectedValueOnce(new Error("refused"));
    const state = newProtectedInput();
    state.values = { token: "s3cret" };
    await expect(submitProtectedInput(typed, approval, state)).rejects.toThrow("refused");
    expect(state.values).toEqual({ token: "s3cret" });
    expect(state.submitting).toBe(false);
  });
});
