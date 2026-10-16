/**
 * Provider sign-in presentation over `@workspace/provider-signin-core`: the
 * device-code panel (the code to type, where to type it, how it completes) and
 * the one action a person has while it waits. What the sign-in says comes from
 * the core's `signInModel`; this only draws it.
 */
import { Box, Button, Code, Flex, Text } from "@radix-ui/themes";
import type { PendingDeviceCodeApproval } from "@vibestudio/shared/approvals";
import { originForUrl } from "@vibestudio/shared/approvalCopy";
import { HOST_APPROVAL_COPY } from "@vibestudio/shared/hostApprovalCopy";
import { signInModel } from "@workspace/provider-signin-core";
import { InlineCode } from "./InlineCode";

export function DeviceCodeBody({ approval }: { approval: PendingDeviceCodeApproval }) {
  const model = signInModel(approval);
  if (model?.kind !== "device-code") return null;
  return (
    <Box
      mt="1"
      p="2"
      style={{
        border: "1px solid var(--gray-a6)",
        borderRadius: 6,
        backgroundColor: "var(--color-panel-translucent)",
        maxWidth: 680,
      }}
    >
      <Flex direction="column" gap="2">
        <Text size="1" color="gray">
          {model.enterCode}
        </Text>
        <Code
          size="6"
          weight="bold"
          style={{
            letterSpacing: "0.3em",
            paddingInline: 12,
            paddingBlock: 6,
            userSelect: "all",
            alignSelf: "flex-start",
          }}
        >
          {model.userCode}
        </Code>
        <Text size="1" color="gray">
          at <InlineCode>{originForUrl(model.verificationUri)}</InlineCode>
        </Text>
        <Text size="1" color="gray" style={{ lineHeight: 1.35 }}>
          {model.help}
        </Text>
      </Flex>
    </Box>
  );
}

export function DeviceCodeActions({ onCancel }: { onCancel: () => void }) {
  return (
    <Button onClick={onCancel} size="2" variant="soft" color="gray">
      {HOST_APPROVAL_COPY.forms.cancel}
    </Button>
  );
}
