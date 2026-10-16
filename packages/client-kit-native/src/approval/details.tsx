import {
  AlertTriangle,
  ChevronDown,
  Globe,
  type IconComponent,
  Lock,
  Settings2,
  User,
  Workflow,
} from "../ui/icons";
import { useKitColors } from "../ui/theme";
import {
  formatAccount,
  formatCredentialInputAudienceSummary,
  formatInjection,
  getApprovalIdentityDetails,
  getApprovalOperationKindLabel,
  originForUrl,
} from "@vibestudio/shared/approvalCopy";
import {
  type ApprovalDetailFormat,
  type PendingApproval,
  type PendingBrowserPermissionApproval,
  type PendingCapabilityApproval,
  type PendingClientConfigApproval,
  type PendingCredentialApproval,
  type PendingCredentialInputApproval,
  type PendingDeviceCodeApproval,
  type PendingSecretInputApproval,
} from "@vibestudio/shared/approvals";
import {
  type InstallReviewOrigin,
  originTextSegments,
} from "@vibestudio/shared/authority/unitInstallReview";
import {
  type CallerInfo,
  evalSummary,
  requesterBreadcrumbSummary,
} from "@workspace/approvals-core";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { ApprovalMarkdown } from "./ApprovalMarkdown";
import { styles } from "./styles";

export function ApprovalDetails({
  approval,
  caller,
  open,
  onToggle,
}: {
  approval: PendingApproval;
  caller: CallerInfo;
  open: boolean;
  onToggle: () => void;
}) {
  const colors = useKitColors();
  const breadcrumbSummary = requesterBreadcrumbSummary(approval);
  const requesterEvalSummary = evalSummary(approval);
  return (
    <View style={styles.detailsBlock}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={onToggle}
        style={styles.detailsSummary}
      >
        <ChevronDown
          size={14}
          color={colors.textSecondary}
          // Visual hint: chevron points down when open, right when closed.
          // Native RN can't rotate icons declaratively without animated value;
          // we keep it static and rely on accessibilityState for assistive tech.
        />
        <Text
          style={[styles.detailsSummaryText, { color: colors.textSecondary }]}
        >
          Request details
        </Text>
      </Pressable>
      {open ? (
        <View style={styles.detailRows}>
          <DetailRow
            icon={User}
            label="Requester"
            value={`${caller.kindLabel} · ${caller.label}`}
            secondary={approval.callerId}
            secondarySelectable
          />
          {breadcrumbSummary ? (
            <DetailRow
              icon={Workflow}
              label="Chain"
              value={breadcrumbSummary}
              code
            />
          ) : null}
          {requesterEvalSummary ? (
            <DetailRow
              icon={Settings2}
              label="Eval"
              value={requesterEvalSummary}
              code
            />
          ) : null}
          {approval.requester ? (
            <DetailRow
              icon={Lock}
              label="Trust key"
              value={approval.requester.stableIdentityKey}
              code
            />
          ) : null}
          {approval.operation ? (
            <DetailRow
              icon={Settings2}
              label="Operation"
              value={`${getApprovalOperationKindLabel(approval.operation.kind)} · ${approval.operation.verb}${
                approval.operation.object
                  ? ` · ${approval.operation.object.value}`
                  : ""
              }`}
              code
            />
          ) : null}
          {approval.kind === "capability" && approval.snapshot ? (
            <>
              <DetailRow
                icon={Settings2}
                label="RPC"
                value={`${approval.snapshot.service}.${approval.snapshot.method}`}
                code
              />
              <DetailRow
                icon={Lock}
                label="Authority"
                value={approval.capability}
                code
              />
              <DetailRow
                icon={Lock}
                label="Authority target"
                value={
                  approval.grantResourceKey ?? approval.snapshot.resourceKey
                }
                code
              />
            </>
          ) : null}
          {getApprovalIdentityDetails(approval).map(({ label, value }) => (
            <DetailRow
              key={label}
              icon={Globe}
              label={label}
              value={value}
              code
            />
          ))}
          {approval.kind === "credential" ? (
            <CredentialDetails approval={approval} />
          ) : approval.kind === "client-config" ? (
            <ClientConfigDetails approval={approval} />
          ) : approval.kind === "credential-input" ? (
            <CredentialInputDetails approval={approval} />
          ) : approval.kind === "secret-input" ? (
            <SecretInputDetails approval={approval} />
          ) : approval.kind === "device-code" ? (
            <DeviceCodeDetails approval={approval} />
          ) : approval.kind === "unit-install-review" ? null : approval.kind ===
            "browser-permission" ? (
            <BrowserPermissionDetails approval={approval} />
          ) : (
            <CapabilityDetails approval={approval} />
          )}
        </View>
      ) : null}
    </View>
  );
}

function CredentialDetails({
  approval,
}: {
  approval: PendingCredentialApproval;
}) {
  const oauthOrigins = [
    approval.oauthAuthorizeOrigin,
    approval.oauthTokenOrigin,
    approval.oauthUserinfoOrigin,
  ].filter((origin): origin is string => !!origin);
  return (
    <>
      <DetailRow
        icon={Lock}
        label="Account"
        value={formatAccount(approval)}
        code
      />
      <DetailRow
        icon={Lock}
        label="Injects as"
        value={formatInjection(approval)}
        code
      />
      {approval.bindingLabel ? (
        <DetailRow
          icon={Lock}
          label="Binding"
          value={approval.bindingLabel}
          code
        />
      ) : null}
      {approval.grantResource ? (
        <DetailRow
          icon={Globe}
          label="Grant"
          value={`${approval.grantResource.bindingId} ${approval.grantResource.action} ${approval.grantResource.resource}`}
          code
        />
      ) : null}
      {approval.gitOperation ? (
        <>
          <DetailRow
            icon={Lock}
            label="Operation"
            value={approval.gitOperation.label}
            code
          />
          <DetailRow
            icon={Globe}
            label="Remote"
            value={approval.gitOperation.remote}
            code
          />
        </>
      ) : null}
      <DetailRow
        icon={Globe}
        label="Audience"
        value={approval.audience
          .map((audience) => `${audience.match}: ${audience.url}`)
          .join("\n")}
        code
      />
      {oauthOrigins.length > 0 ? (
        <DetailRow
          icon={Globe}
          label="OAuth"
          value={oauthOrigins.join("\n")}
          danger={!!approval.oauthAudienceDomainMismatch}
          code
        />
      ) : null}
      {approval.oauthAudienceDomainMismatch ? (
        <DetailRow
          icon={AlertTriangle}
          label="Warning"
          value="OAuth domain differs from audience"
          danger
        />
      ) : null}
      {approval.scopes.length > 0 ? (
        <DetailRow
          icon={Lock}
          label="Scopes"
          value={approval.scopes.join(", ")}
          code
        />
      ) : null}
    </>
  );
}

function ClientConfigDetails({
  approval,
}: {
  approval: PendingClientConfigApproval;
}) {
  const tokenOrigin = originForUrl(approval.tokenUrl);
  const authorizeOrigin = originForUrl(approval.authorizeUrl);
  return (
    <>
      <DetailRow icon={Lock} label="Client" value={approval.configId} code />
      <DetailRow
        icon={Globe}
        label="Authorize"
        value={approval.authorizeUrl}
        code
      />
      <DetailRow
        icon={Globe}
        label="Token URL"
        value={approval.tokenUrl}
        code
      />
      <DetailRow
        icon={Lock}
        label="Binding"
        value={`Secret use limited to ${tokenOrigin}${authorizeOrigin !== tokenOrigin ? `\nSign-in starts at ${authorizeOrigin}` : ""}`}
      />
      <DetailRow
        icon={Lock}
        label="Fields"
        value={approval.fields
          .map(
            (field) =>
              `${field.name}${field.type === "secret" ? " (secret)" : ""}`,
          )
          .join(", ")}
        code
      />
    </>
  );
}

function CredentialInputDetails({
  approval,
}: {
  approval: PendingCredentialInputApproval;
}) {
  return (
    <>
      <DetailRow
        icon={Lock}
        label="Service"
        value={approval.credentialLabel}
        code
      />
      <DetailRow
        icon={Lock}
        label="Injects as"
        value={formatInjection(approval)}
        code
      />
      <DetailRow
        icon={Globe}
        label="Audience"
        value={formatCredentialInputAudienceSummary(approval)}
        code
      />
      <DetailRow
        icon={Lock}
        label="Fields"
        value={approval.fields
          .map(
            (field) =>
              `${field.name}${field.type === "secret" ? " (secret)" : ""}`,
          )
          .join(", ")}
        code
      />
      {approval.scopes.length > 0 ? (
        <DetailRow
          icon={Lock}
          label="Scopes"
          value={approval.scopes.join(", ")}
          code
        />
      ) : null}
    </>
  );
}

function SecretInputDetails({
  approval,
}: {
  approval: PendingSecretInputApproval;
}) {
  return (
    <>
      {(approval.details ?? []).map((detail) => (
        <DetailRow
          key={detail.label}
          icon={Lock}
          label={detail.label}
          value={detail.value}
          code={!detail.format}
          format={detail.format}
        />
      ))}
      <DetailRow
        icon={Lock}
        label="Fields"
        value={approval.fields
          .map(
            (field) =>
              `${field.name}${field.type === "secret" ? " (secret)" : ""}`,
          )
          .join(", ")}
        code
      />
    </>
  );
}

function CapabilityDetails({
  approval,
}: {
  approval: PendingCapabilityApproval;
}) {
  return (
    <>
      {approval.resource ? (
        <DetailRow
          icon={Globe}
          label={approval.resource.label}
          value={approval.resource.value}
          code
        />
      ) : null}
      {(approval.details ?? []).map((detail) => (
        <DetailRow
          key={detail.label}
          icon={Lock}
          label={detail.label}
          value={detail.value}
          code={!detail.format}
          format={detail.format}
        />
      ))}
    </>
  );
}

function BrowserPermissionDetails({
  approval,
}: {
  approval: PendingBrowserPermissionApproval;
}) {
  return (
    <>
      <DetailRow icon={Globe} label="Site" value={approval.origin} code />
      <DetailRow
        icon={Lock}
        label="Permissions"
        value={approval.capabilities.join(", ")}
        code
      />
      <DetailRow
        icon={Settings2}
        label="Device"
        value={approval.deviceLabel}
        code
      />
    </>
  );
}

function DeviceCodeDetails({
  approval,
}: {
  approval: PendingDeviceCodeApproval;
}) {
  return (
    <>
      <DetailRow
        icon={Lock}
        label="Service"
        value={approval.credentialLabel}
        code
      />
      <DetailRow
        icon={Globe}
        label="Verify at"
        value={approval.verificationUri}
        code
      />
      <DetailRow
        icon={Lock}
        label="Provider"
        value={originForUrl(approval.oauthTokenOrigin)}
        code
      />
    </>
  );
}

export function DetailRow({
  icon: RowIcon,
  label,
  value,
  code,
  format,
  danger,
  secondary,
  secondarySelectable,
  emphasizeOrigin,
}: {
  icon: IconComponent;
  label: string;
  value: string;
  /**
   * When the value is an identity string, the origin it belongs to — so the
   * registrable domain is emphasized WITHIN the URL rather than the URL being
   * shortened to it (§7.6.3). Weight and an underline, never colour, so the
   * emphasis survives a monochrome display; the row's accessibility label
   * already reads the whole string, and the `Domain` row beside it states in
   * words what the emphasis draws.
   */
  emphasizeOrigin?: InstallReviewOrigin;
  code?: boolean;
  format?: ApprovalDetailFormat;
  danger?: boolean;
  /** Optional supplementary value (e.g. the full opaque id under a label). */
  secondary?: string;
  secondarySelectable?: boolean;
}) {
  const colors = useKitColors();
  const content =
    format === "markdown" ? (
      <ApprovalMarkdown
        source={value}
        tone={danger ? "danger" : "default"}
        compact
      />
    ) : format === "tree" ? (
      <CollapsibleTree value={value} colors={colors} />
    ) : (
      <Text
        selectable={code || format === "code"}
        style={[
          styles.detailValue,
          code || format === "code" ? styles.codeText : null,
          {
            color: danger ? colors.danger : colors.text,
            backgroundColor:
              code || format === "code" ? colors.codeBackground : "transparent",
          },
        ]}
      >
        {emphasizeOrigin
          ? originTextSegments(value, emphasizeOrigin).map((segment, index) => (
              <Text
                key={index}
                style={
                  segment.emphasized
                    ? { fontWeight: "800", textDecorationLine: "underline" }
                    : undefined
                }
              >
                {segment.text}
              </Text>
            ))
          : value}
      </Text>
    );
  return (
    <View accessibilityLabel={`${label}: ${value}`} style={styles.detailRow}>
      <RowIcon
        size={14}
        color={danger ? colors.danger : colors.textSecondary}
      />
      <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>
        {label}
      </Text>
      <View style={styles.detailValueColumn}>
        {content}
        {secondary ? (
          <Text
            selectable={secondarySelectable}
            style={[
              styles.detailValueSecondary,
              styles.codeText,
              {
                color: colors.textSecondary,
                backgroundColor: colors.codeBackground,
              },
            ]}
          >
            {secondary}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function CollapsibleTree({
  value,
  colors,
}: {
  value: string;
  colors: { text: string; codeBackground: string; textSecondary: string };
}) {
  const [open, setOpen] = useState(false);
  const lines = value.split("\n");
  const summary = lines[0] ?? "";
  const hasBody = lines.length > 1;
  if (!hasBody) {
    return (
      <Text style={[styles.detailValue, { color: colors.text }]}>
        {summary}
      </Text>
    );
  }
  return (
    <View>
      <Pressable
        onPress={() => setOpen((prev) => !prev)}
        style={{ flexDirection: "row", gap: 4 }}
      >
        <Text
          style={[
            styles.detailValue,
            { color: colors.textSecondary, flexShrink: 0 },
          ]}
        >
          {open ? "▾" : "▸"}
        </Text>
        <Text style={[styles.detailValue, { color: colors.text }]}>
          {summary}
        </Text>
      </Pressable>
      {open ? (
        <Text
          style={[
            styles.detailValue,
            styles.codeText,
            {
              color: colors.text,
              backgroundColor: colors.codeBackground,
              marginTop: 4,
              padding: 6,
              borderRadius: 6,
            },
          ]}
        >
          {lines.slice(1).join("\n")}
        </Text>
      ) : null}
    </View>
  );
}
