import {
  AlertTriangle,
  CheckCircle2,
  type IconComponent,
  XCircle,
} from "../ui/icons";
import { useKitColors } from "../ui/theme";
import {
  getInstallReviewActionCopy,
  getRecommendedStandardDecision,
  getStandardApprovalDecisionActions,
} from "@vibestudio/shared/approvalCopy";
import {
  type ApprovalDecision,
  type PendingBrowserPermissionApproval,
  type PendingCapabilityApproval,
  type PendingClientConfigApproval,
  type PendingCredentialApproval,
  type PendingCredentialInputApproval,
  type PendingSecretInputApproval,
  type PendingUnitInstallReviewApproval,
} from "@vibestudio/shared/approvals";
import {
  selectionStatusLine,
  type TemplateAcceptance,
} from "@vibestudio/shared/authority/unitInstallReview";
import { HOST_APPROVAL_COPY } from "@vibestudio/shared/hostApprovalCopy";
import { approvalDecisionOptions } from "@workspace/approvals-core";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { styles } from "./styles";
import { ButtonVariant, PendingAction } from "./types";

export function DeviceCodeActions({
  busy,
  pendingAction,
  onCancel,
}: {
  busy: boolean;
  pendingAction: PendingAction | null;
  onCancel: () => void;
}) {
  return (
    <View style={styles.actionRow}>
      <DecisionButton
        label={HOST_APPROVAL_COPY.forms.cancel}
        description={HOST_APPROVAL_COPY.forms.cancelDeviceSignInDescription}
        variant="outline"
        disabled={busy}
        loading={pendingAction === "dismiss"}
        icon={XCircle}
        onPress={onCancel}
        testID="approval-action-device-cancel"
      />
    </View>
  );
}

export function StandardActions({
  approval,
  busy,
  pendingAction,
  onChoose,
}: {
  approval: PendingCredentialApproval | PendingCapabilityApproval;
  busy: boolean;
  pendingAction: PendingAction | null;
  onChoose: (decision: ApprovalDecision) => void;
}) {
  const recommendedDecision = getRecommendedStandardDecision(approval);
  const isSevereCapability =
    approval.kind === "capability" && approval.severity === "severe";
  // The decisions on offer are the core's (a trust change is once or deny, never
  // a standing grant); the host's copy supplies each one's description.
  const described = getStandardApprovalDecisionActions(approval);
  const actions = approvalDecisionOptions(approval).flatMap(({ decision }) =>
    described.filter((action) => action.decision === decision),
  );
  // Task scope is the recommended answer for ordinary gated work. Keep it in
  // the primary row with the narrow one-shot and decline choices; standing
  // trust remains in the secondary row.
  const primaryDecisionSet =
    recommendedDecision === "task"
      ? new Set(["once", "task", "deny"])
      : new Set(["once", "version", "deny"]);
  const primaryActions = actions.filter((action) =>
    primaryDecisionSet.has(action.decision),
  );
  const secondaryActions = actions.filter(
    (action) => !primaryDecisionSet.has(action.decision),
  );
  return (
    <View style={styles.actionGroups}>
      <View style={styles.actionRow}>
        {primaryActions.map((action) => {
          const recommended = action.decision === recommendedDecision;
          return (
            <DecisionButton
              key={action.decision}
              label={action.label}
              description={action.description}
              variant={
                action.decision === "deny"
                  ? "danger"
                  : recommended
                    ? isSevereCapability
                      ? "dangerPrimary"
                      : "primary"
                    : "surface"
              }
              disabled={busy}
              loading={pendingAction === action.decision}
              {...(action.decision === "deny" || isSevereCapability
                ? { icon: action.decision === "deny" ? XCircle : AlertTriangle }
                : action.decision === "version"
                  ? { icon: CheckCircle2 }
                  : {})}
              onPress={() => onChoose(action.decision)}
              testID={`approval-action-${action.decision}`}
            />
          );
        })}
      </View>
      <View style={styles.actionRow}>
        {secondaryActions.map((action) => {
          const destructive = action.decision === "lock";
          return (
            <DecisionButton
              key={action.decision}
              label={action.label}
              description={action.description}
              variant={destructive ? "danger" : "outline"}
              disabled={busy}
              loading={pendingAction === action.decision}
              {...(destructive ? { icon: XCircle } : {})}
              onPress={() => onChoose(action.decision)}
              testID={`approval-action-${action.decision}`}
            />
          );
        })}
      </View>
    </View>
  );
}

export function BrowserPermissionActions({
  approval,
  busy,
  pendingAction,
  onChoose,
}: {
  approval: PendingBrowserPermissionApproval;
  busy: boolean;
  pendingAction: PendingAction | null;
  onChoose: (decision: ApprovalDecision) => void;
}) {
  const copy = HOST_APPROVAL_COPY.actions.browserPermission;
  const actions: Array<{
    decision: "once" | "session" | "always";
    label: string;
    description: string;
    variant: ButtonVariant;
  }> = [
    {
      decision: "once",
      ...copy.once,
      variant: "primary",
    },
    {
      decision: "session",
      ...copy.session,
      variant: "surface",
    },
    {
      decision: "always",
      ...copy.always,
      variant: "outline",
    },
  ];
  const allowed = approvalDecisionOptions(approval).map(
    ({ decision }) => decision,
  );
  const offered = actions.filter((action) => allowed.includes(action.decision));
  return (
    <View style={styles.actionGroups}>
      {[offered.slice(0, 1), offered.slice(1, 3)]
        .filter((row) => row.length > 0)
        .map((row, index) => (
          <View key={index} style={styles.actionRow}>
            {row.map((action) => (
              <DecisionButton
                key={action.decision}
                label={action.label}
                description={action.description}
                variant={action.variant}
                disabled={busy}
                loading={pendingAction === action.decision}
                onPress={() => onChoose(action.decision)}
                testID={`approval-action-${action.decision}`}
              />
            ))}
          </View>
        ))}
      <View style={styles.actionRow}>
        <DecisionButton
          label={copy.block.label}
          description={copy.block.description}
          variant="danger"
          disabled={busy}
          loading={pendingAction === "block"}
          icon={XCircle}
          onPress={() => onChoose("block")}
          testID="approval-action-block"
        />
        <DecisionButton
          label={copy.dismiss.label}
          description={copy.dismiss.description}
          variant="surface"
          disabled={busy}
          loading={pendingAction === "dismiss"}
          onPress={() => onChoose("dismiss")}
          testID="approval-action-dismiss"
        />
      </View>
    </View>
  );
}

export function InstallReviewActions({
  approval,
  allowNow,
  busy,
  pendingAction,
  onAccept,
  onCancel,
}: {
  approval: PendingUnitInstallReviewApproval;
  allowNow: TemplateAcceptance["allowNow"];
  busy: boolean;
  pendingAction: PendingAction | null;
  onAccept: () => void;
  onCancel: () => void;
}) {
  const colors = useKitColors();
  const copy = getInstallReviewActionCopy(approval);
  // The footer restates the selection in plain terms and updates live as rows
  // are checked and unchecked (§7.2) — never shown for the one-line "no
  // permission changes" upgrade, which the header already states in full.
  const statusLine =
    approval.parts.length === 0 && approval.unchangedPartCount > 0
      ? null
      : selectionStatusLine({ parts: approval.parts, allowNow });
  return (
    <View style={styles.actionGroups}>
      {statusLine ? (
        <Text
          accessibilityLiveRegion="polite"
          style={[styles.helperText, { color: colors.textSecondary }]}
        >
          {statusLine}
        </Text>
      ) : null}
      <View style={styles.actionRow}>
        <DecisionButton
          label={copy.accept.label}
          description={copy.accept.description}
          variant="primary"
          disabled={busy}
          loading={pendingAction === "once"}
          onPress={onAccept}
          testID="approval-action-accept-install-review"
        />
        {/* No "Not now" on the creation review: the workspace already exists,
            and the equivalent escape is unchecking everything. */}
        {copy.decline ? (
          <DecisionButton
            label={copy.decline.label}
            description={copy.decline.description}
            variant="outline"
            disabled={busy}
            loading={pendingAction === "dismiss"}
            icon={XCircle}
            onPress={onCancel}
            testID="approval-action-cancel-install-review"
          />
        ) : null}
      </View>
    </View>
  );
}

export function ClientConfigActions(props: {
  approval: PendingClientConfigApproval;
  values: Record<string, string>;
  busy: boolean;
  pendingAction: PendingAction | null;
  onSubmit: () => void;
  onDeny: () => void;
}) {
  return (
    <InputApprovalActions {...props} submitAction="submit-client-config" />
  );
}

export function CredentialInputActions(props: {
  approval: PendingCredentialInputApproval;
  values: Record<string, string>;
  busy: boolean;
  pendingAction: PendingAction | null;
  onSubmit: () => void;
  onDeny: () => void;
}) {
  return (
    <InputApprovalActions {...props} submitAction="submit-credential-input" />
  );
}

export function SecretInputActions(props: {
  approval: PendingSecretInputApproval;
  values: Record<string, string>;
  busy: boolean;
  pendingAction: PendingAction | null;
  onSubmit: () => void;
  onDeny: () => void;
}) {
  return (
    <InputApprovalActions
      {...props}
      submitAction="submit-secret-input"
      submitLabel={HOST_APPROVAL_COPY.forms.continue}
      submitDescription={HOST_APPROVAL_COPY.forms.useSecretOnceDescription}
      denyDescription={HOST_APPROVAL_COPY.forms.secretDenied}
    />
  );
}

function InputApprovalActions({
  approval,
  values,
  busy,
  pendingAction,
  onSubmit,
  onDeny,
  submitAction,
  submitLabel = HOST_APPROVAL_COPY.forms.saveService,
  submitDescription = HOST_APPROVAL_COPY.forms.saveServiceDescription,
  denyDescription = HOST_APPROVAL_COPY.forms.saveServiceDenied,
}: {
  approval:
    | PendingClientConfigApproval
    | PendingCredentialInputApproval
    | PendingSecretInputApproval;
  values: Record<string, string>;
  busy: boolean;
  pendingAction: PendingAction | null;
  onSubmit: () => void;
  onDeny: () => void;
  submitAction: PendingAction;
  submitLabel?: string;
  submitDescription?: string;
  denyDescription?: string;
}) {
  const missingRequired = approval.fields.some(
    (field) => field.required && !values[field.name]?.trim(),
  );
  return (
    <View style={styles.actionRow}>
      <DecisionButton
        label={submitLabel}
        description={submitDescription}
        variant="primary"
        disabled={busy || missingRequired}
        loading={pendingAction === submitAction}
        onPress={onSubmit}
        testID="approval-submit"
      />
      <DecisionButton
        label={HOST_APPROVAL_COPY.chrome.deny}
        description={denyDescription}
        variant="danger"
        disabled={busy}
        loading={pendingAction === "deny"}
        icon={XCircle}
        onPress={onDeny}
        testID="approval-action-deny"
      />
    </View>
  );
}

function DecisionButton({
  label,
  description,
  variant,
  disabled,
  loading,
  icon: ButtonIcon = CheckCircle2,
  onPress,
  testID,
}: {
  label: string;
  description: string;
  variant: ButtonVariant;
  disabled: boolean;
  loading: boolean;
  icon?: IconComponent;
  onPress: () => void;
  testID: string;
}) {
  const colors = useKitColors();
  const style = buttonStyle(colors, variant);
  return (
    <Pressable
      accessibilityLabel={`${label}. ${description}`}
      accessibilityRole="button"
      accessibilityState={{ disabled, busy: loading }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.decisionButton,
        style.button,
        disabled ? styles.disabled : null,
        pressed && !disabled ? styles.pressed : null,
      ]}
      testID={testID}
    >
      {loading ? (
        <ActivityIndicator color={style.text.color} size="small" />
      ) : (
        <ButtonIcon size={16} color={style.text.color} />
      )}
      <Text
        numberOfLines={2}
        adjustsFontSizeToFit
        style={[styles.decisionText, style.text]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function buttonStyle(
  colors: {
    background: string;
    border: string;
    danger: string;
    primary: string;
    text: string;
  },
  variant: ButtonVariant,
) {
  if (variant === "primary") {
    return {
      button: { backgroundColor: colors.primary, borderColor: colors.primary },
      text: { color: "#ffffff" },
    };
  }
  if (variant === "danger") {
    return {
      button: { backgroundColor: "transparent", borderColor: colors.danger },
      text: { color: colors.danger },
    };
  }
  if (variant === "dangerPrimary") {
    return {
      button: { backgroundColor: colors.danger, borderColor: colors.danger },
      text: { color: "#ffffff" },
    };
  }
  if (variant === "outline") {
    return {
      button: { backgroundColor: "transparent", borderColor: colors.border },
      text: { color: colors.text },
    };
  }
  return {
    button: { backgroundColor: colors.background, borderColor: colors.border },
    text: { color: colors.text },
  };
}
