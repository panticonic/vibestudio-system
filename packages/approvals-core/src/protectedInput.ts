import type { PendingApproval } from "@vibestudio/shared/approvals";
import type { ApprovalsClient } from "./client.js";

/**
 * Protected inputs are typed only into trusted chrome.
 *
 * A form, a credential or a secret is answered with values the person types, and
 * those values must never reach a hosted session, a log or any untrusted
 * surface. The guarantee is structural and is kept by three rules here:
 *
 * 1. Editing is a pure function of one immutable approval and one state object
 *    (`editProtectedInput`). Values live only in that state, owned by the chrome
 *    that is showing the approval; nothing in this module logs them or hands
 *    them to a caller-supplied sink.
 * 2. The only way out is `submitProtectedInput`, which sends them through the
 *    approval's own typed submit method (`submitClientConfig`,
 *    `submitCredentialInput`, `submitSecretInput`) and nothing else. Generic
 *    `resolve` cannot carry values, and cannot be used to accept these kinds.
 * 3. A chrome that shows a protected approval must route every key and paste
 *    to `editProtectedInput` instead of to the session beneath it
 *    (`isProtectedApproval` is the gate it checks).
 */

export type ProtectedApproval = Extract<
  PendingApproval,
  { kind: "client-config" | "credential-input" | "secret-input" }
>;

export interface ProtectedInputState {
  field: number;
  values: Record<string, string>;
  error: string | null;
  submitting: boolean;
}

/**
 * What the editor reads from an input device: a key by normalized name (`"a"`,
 * `"enter"`, `"tab"`, `"backtab"`, `"left"`, ...) or a paste. Every runtime maps
 * its own events onto this; the terminal tokenizer's key and paste events are
 * already this shape.
 */
export type ProtectedInputEvent =
  | { kind: "key"; name: string }
  | { kind: "paste"; text: string };

export const newProtectedInput = (): ProtectedInputState => ({
  field: 0,
  values: {},
  error: null,
  submitting: false,
});

export function isProtectedApproval(
  approval: PendingApproval | undefined
): approval is ProtectedApproval {
  return (
    approval?.kind === "client-config" ||
    approval?.kind === "credential-input" ||
    approval?.kind === "secret-input"
  );
}

/** Editing is local to one immutable approval id. Values never enter logs or session input. */
export function editProtectedInput(
  approval: ProtectedApproval,
  state: ProtectedInputState,
  event: ProtectedInputEvent
): "submit" | "cancel" | null {
  if (event.kind === "key" && event.name === "escape") return "cancel";
  if (state.submitting) return null;
  if (event.kind === "key" && (event.name === "tab" || event.name === "backtab")) {
    state.field =
      (state.field + (event.name === "tab" ? 1 : -1) + approval.fields.length + 1) %
      (approval.fields.length + 1);
    return null;
  }
  if (event.kind === "key" && event.name === "enter") {
    if (waitsForProviderCallback(approval)) return null;
    if (state.field < approval.fields.length) {
      state.field++;
      return null;
    }
    const missing = approval.fields.find(
      (field) => field.required && !state.values[field.name]?.trim()
    );
    if (missing) {
      state.error = `${missing.label} is required`;
      state.field = approval.fields.indexOf(missing);
      return null;
    }
    return "submit";
  }
  const field = approval.fields[state.field];
  if (!field) return null;
  const value = state.values[field.name] ?? "";
  if (field.type === "select") {
    if (event.kind === "key" && (event.name === "left" || event.name === "right")) {
      const index = field.options.findIndex((option) => option.id === value);
      const option =
        field.options[
          (index + (event.name === "left" ? -1 : 1) + field.options.length) % field.options.length
        ];
      if (option) state.values[field.name] = option.id;
    }
  } else if (event.kind === "paste") state.values[field.name] = value + event.text;
  else if (event.kind === "key" && event.name === "backspace") {
    const segments = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value)];
    state.values[field.name] = value.slice(0, segments.at(-1)?.index ?? 0);
  } else if (
    event.kind === "key" &&
    [...event.name].length === 1 &&
    event.name.codePointAt(0)! >= 32
  )
    state.values[field.name] = value + event.name;
  state.error = null;
  return null;
}

/** A browser-based sign-in with no fields: the request closes when the provider's callback arrives. */
export function waitsForProviderCallback(approval: ProtectedApproval): boolean {
  return (
    approval.kind === "credential-input" &&
    approval.browserSignIn?.callbackExpected === true &&
    approval.fields.length === 0
  );
}

/**
 * Send the entered values through the approval's own typed submit method. The
 * state is marked submitting for the duration; on success the values are
 * cleared, on failure they stay for a retry and the error is the caller's to
 * report (the rejection is returned to it, never swallowed).
 */
export async function submitProtectedInput(
  client: Pick<
    ApprovalsClient,
    "submitClientConfig" | "submitCredentialInput" | "submitSecretInput"
  >,
  approval: ProtectedApproval,
  state: ProtectedInputState
): Promise<void> {
  state.submitting = true;
  try {
    const values = { ...state.values };
    if (approval.kind === "client-config") await client.submitClientConfig(approval.approvalId, values);
    else if (approval.kind === "credential-input")
      await client.submitCredentialInput(approval.approvalId, values);
    else await client.submitSecretInput(approval.approvalId, values);
    state.values = {};
  } catch (error) {
    state.submitting = false;
    throw error;
  }
}
