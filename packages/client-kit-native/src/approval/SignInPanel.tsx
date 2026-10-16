import { useKitColors } from "../ui/theme";
import { originForUrl } from "@vibestudio/shared/approvalCopy";
import type { PendingDeviceCodeApproval } from "@vibestudio/shared/approvals";
import { signInModel } from "@workspace/provider-signin-core";
import { Text, View } from "react-native";
import { styles } from "./styles";

export function DeviceCodePanel({
  approval,
}: {
  approval: PendingDeviceCodeApproval;
}) {
  const colors = useKitColors();
  const signIn = signInModel(approval);
  if (signIn?.kind !== "device-code") return null;
  return (
    <View
      style={[
        styles.issuerPanel,
        {
          backgroundColor: colors.surfaceSunken,
          borderColor: colors.borderSubtle,
        },
      ]}
    >
      <Text style={[styles.helperText, { color: colors.textSecondary }]}>
        {signIn.enterCode}
      </Text>
      <Text
        accessibilityLabel={`Device code ${signIn.userCode}`}
        selectable
        style={[
          styles.deviceCode,
          { color: colors.text, backgroundColor: colors.codeBackground },
        ]}
      >
        {signIn.userCode}
      </Text>
      <Text style={[styles.helperText, { color: colors.textSecondary }]}>
        at{" "}
        <Text style={[styles.codeText, { color: colors.text }]}>
          {originForUrl(signIn.verificationUri)}
        </Text>
      </Text>
      <Text style={[styles.helperText, { color: colors.textSecondary }]}>
        {signIn.help}
      </Text>
    </View>
  );
}
