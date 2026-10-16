import React from "react";
import { Box, Text } from "ink";
import {
  getApprovalCopy,
  getApprovalCallerPresentation,
  formatInjection,
} from "@vibestudio/shared/approvalCopy";
import {
  waitsForProviderCallback,
  type ProtectedApproval,
  type ProtectedInputState,
} from "@workspace/approvals-core";
import { signInModel } from "@workspace/provider-signin-core";
import { Clickable } from "../clickable.js";

/**
 * A protected input as it is drawn: only in trusted chrome, as the host's own
 * overlay. The values live in the `ProtectedInputState` the owner passes in and
 * are drawn masked (`•`) for secret fields; nothing here writes them anywhere
 * else. The owner must route keys and pastes to `editProtectedInput`, never to
 * a session (see `@workspace/approvals-core` protectedInput).
 */

export function ProtectedInputDetail({
  approval,
  state,
}: {
  approval: ProtectedApproval;
  state: ProtectedInputState;
}): React.ReactElement {
  const copy = getApprovalCopy(approval);
  const caller = getApprovalCallerPresentation(approval);
  const waitingForCallback = waitsForProviderCallback(approval);
  const signIn = signInModel(approval);
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
      {signIn && signIn.kind !== "device-code" ? <Text>{signIn.instructions}</Text> : null}
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
