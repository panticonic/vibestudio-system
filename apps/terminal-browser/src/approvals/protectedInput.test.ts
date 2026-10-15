import { describe, expect, it } from "vitest";
import { editProtectedInput, newProtectedInput, type ProtectedApproval } from "./protectedInput.js";

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
      callerKind: "app",
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
});
