import { Badge } from "../ui/Badge";
import { AlertTriangle } from "../ui/icons";
import { useKitColors } from "../ui/theme";
import {
  type PendingClientConfigApproval,
  type PendingCredentialInputApproval,
  type PendingSecretInputApproval,
} from "@vibestudio/shared/approvals";
import { HOST_APPROVAL_COPY } from "@vibestudio/shared/hostApprovalCopy";
import { Text, TextInput, View } from "react-native";
import { ApprovalMarkdown } from "./ApprovalMarkdown";
import { styles } from "./styles";

export function InlineError({ message }: { message: string }) {
  const colors = useKitColors();
  return (
    <View style={[styles.warningBand, { backgroundColor: colors.dangerSoft }]}>
      <AlertTriangle size={14} color={colors.danger} />
      <Text style={[styles.warningText, { color: colors.danger }]}>
        {message}
      </Text>
    </View>
  );
}

export function SecretConfigFields({
  approval,
  values,
  onChange,
}: {
  approval:
    | PendingClientConfigApproval
    | PendingCredentialInputApproval
    | PendingSecretInputApproval;
  values: Record<string, string>;
  onChange: (name: string, value: string) => void;
}) {
  const colors = useKitColors();
  return (
    <View style={styles.fields}>
      <Text style={[styles.helperText, { color: colors.textSecondary }]}>
        {approval.kind === "secret-input"
          ? HOST_APPROVAL_COPY.forms.ephemeralSecretHelp
          : HOST_APPROVAL_COPY.forms.storedSecretHelp}
      </Text>
      {approval.fields.map((field) => (
        <View key={field.name} style={styles.fieldBlock}>
          <View style={styles.fieldLabelRow}>
            <Text style={[styles.fieldLabel, { color: colors.text }]}>
              {field.label}
            </Text>
            {field.required ? (
              <Badge
                label={HOST_APPROVAL_COPY.chrome.required}
                tone="warning"
              />
            ) : null}
            {field.type === "secret" ? (
              <Badge label={HOST_APPROVAL_COPY.chrome.secret} />
            ) : null}
          </View>
          <TextInput
            accessibilityLabel={field.label}
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={(text) => onChange(field.name, text)}
            placeholder={field.label}
            placeholderTextColor={colors.textTertiary}
            secureTextEntry={field.type === "secret"}
            style={[
              styles.input,
              {
                backgroundColor: colors.surfaceSunken,
                borderColor: colors.border,
                color: colors.text,
              },
            ]}
            testID={`approval-field-${field.name}`}
            value={values[field.name] ?? ""}
          />
          {field.description ? (
            <ApprovalMarkdown source={field.description} tone="muted" compact />
          ) : null}
        </View>
      ))}
    </View>
  );
}
