import React from "react";
import { Box, Text } from "ink";
import { Clickable } from "../ui/clickable.js";
import type { PendingApproval } from "@vibestudio/shared/approvals";
import type { InputEvent, MouseEvent } from "../input/tokenizer.js";
import {
  getApprovalCopy,
  getApprovalCallerPresentation,
  formatInjection,
} from "@vibestudio/shared/approvalCopy";

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
  event: Exclude<InputEvent, MouseEvent>
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
    if (
      approval.kind === "credential-input" &&
      approval.browserSignIn?.callbackExpected &&
      approval.fields.length === 0
    )
      return null;
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

export function ProtectedInputDetail({
  approval,
  state,
}: {
  approval: ProtectedApproval;
  state: ProtectedInputState;
}): React.ReactElement {
  const copy = getApprovalCopy(approval);
  const caller = getApprovalCallerPresentation(approval);
  const waitingForCallback =
    approval.kind === "credential-input" &&
    approval.browserSignIn?.callbackExpected &&
    approval.fields.length === 0;
  return (
    <Box flexDirection="column">
      <Text bold>{approval.title}</Text>
      <Text dimColor>{`Requested by ${caller.label}`}</Text>
      <Text>{copy.summary}</Text>
      {approval.description ? <Text>{approval.description}</Text> : null}
      {approval.kind === "secret-input" && approval.warning ? (
        <Text color="yellow">{approval.warning}</Text>
      ) : null}
      {approval.kind === "secret-input"
        ? approval.details?.map((detail, index) => (
            <Text key={index}>{`${detail.label}: ${detail.value}`}</Text>
          ))
        : null}
      {approval.kind === "client-config" ? (
        <>
          <Text>{`Authorization: ${approval.authorizeUrl}`}</Text>
          <Text>{`Token endpoint: ${approval.tokenUrl}`}</Text>
        </>
      ) : null}
      {approval.kind === "credential-input" ? (
        <>
          <Text>{`Credential: ${approval.credentialLabel} · ${formatInjection(approval)}`}</Text>
          {approval.accountIdentity.email ||
          approval.accountIdentity.username ||
          approval.accountIdentity.workspaceName ? (
            <Text>{`Account: ${approval.accountIdentity.email ?? approval.accountIdentity.username ?? approval.accountIdentity.workspaceName}`}</Text>
          ) : null}
          {approval.audience.map((audience, index) => (
            <Text key={index}>{`For ${audience.url} (${audience.match})`}</Text>
          ))}
          {approval.scopes.length ? <Text>{`Scopes: ${approval.scopes.join(", ")}`}</Text> : null}
        </>
      ) : null}
      {approval.kind === "credential-input" && approval.browserSignIn ? (
        <Text>
          {approval.browserSignIn.instructions ??
            (approval.browserSignIn.callbackExpected
              ? "Complete sign-in in the browser; this request closes when its callback arrives."
              : "Complete sign-in in the browser, then enter the requested fields.")}
        </Text>
      ) : null}
      {approval.fields.map((field, index) => {
        const value = state.values[field.name] ?? "";
        const display =
          field.type === "secret"
            ? "•".repeat([...value].length)
            : field.type === "select"
              ? (field.options.find((option) => option.id === value)?.label ?? "← → choose")
              : value;
        return (
          <Box key={field.name} flexDirection="column">
            <Clickable id={`field:${field.name}`} action={{ field: index }}>
              <Text
                inverse={state.field === index}
              >{`${field.label}${field.required ? " *" : ""}: ${display}`}</Text>
            </Clickable>
            {field.description ? <Text dimColor>{field.description}</Text> : null}
            {field.type === "select" &&
            field.options.find((option) => option.id === value)?.description ? (
              <Text dimColor>
                {field.options.find((option) => option.id === value)?.description}
              </Text>
            ) : null}
          </Box>
        );
      })}
      <Text inverse={state.field === approval.fields.length}>
        {waitingForCallback
          ? "Waiting for the provider callback…"
          : state.submitting
            ? "Submitting…"
            : "Submit entered values (Enter)"}
      </Text>
      {state.error ? <Text color="red">{state.error}</Text> : null}
      <Text dimColor>
        Tab/Shift-Tab fields · Enter next/submit · ←→ select · Ctrl-G close · values are never sent
        to a tab
      </Text>
    </Box>
  );
}
