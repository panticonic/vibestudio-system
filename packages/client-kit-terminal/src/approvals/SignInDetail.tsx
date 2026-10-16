import React from "react";
import { Box, Text } from "ink";
import type { PendingApproval } from "@vibestudio/shared/approvals";
import { signInModel } from "@workspace/provider-signin-core";

/**
 * A device-code sign-in as the overlay shows it: the code to type on the
 * provider's page, where to type it, and the keys that act on it. The overlay's
 * owner binds `o` to open the verification page and `c` to copy the code
 * (`deviceCodeActions` in provider-signin-core), then waits: the server settles
 * the approval when the provider reports.
 */
export function SignInDetail({
  approval,
}: {
  approval: Extract<PendingApproval, { kind: "device-code" }>;
}): React.ReactElement | null {
  const model = signInModel(approval);
  if (model?.kind !== "device-code") return null;
  return (
    <Box flexDirection="column">
      <Text bold>{model.title}</Text>
      <Text>{`Code: ${model.userCode}`}</Text>
      <Text>{model.verificationUri}</Text>
      <Text>{`Provider: ${model.providerOrigin} · code expires ${new Date(model.expiresAt).toLocaleString()}`}</Text>
      <Text>
        Press o to open verification, c to copy the code. Waiting for the provider to complete
        sign-in.
      </Text>
    </Box>
  );
}
