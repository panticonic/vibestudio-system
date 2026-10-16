import { MobileUnitIcon, type MobileUnitIconKind } from "../ui/MobileUnitIcon";
import {
  AlertTriangle,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  type IconComponent,
  Lock,
  Settings2,
} from "../ui/icons";
import { useKitColors, useKitServerUrl } from "../ui/theme";
import type { ApprovalAttribution } from "@vibestudio/shared/approvalCopy";
import type { PendingApproval } from "@vibestudio/shared/approvals";
import type { CallerInfo } from "@workspace/approvals-core";
import { Pressable, Text, View } from "react-native";
import { ApprovalMarkdown } from "./ApprovalMarkdown";
import { styles } from "./styles";

export function ApprovalHeader({
  approval,
  accentColor,
  queueLength,
  queueIndex,
  canPrev,
  canNext,
  onPrev,
  onNext,
}: {
  approval: PendingApproval;
  accentColor: string;
  queueLength: number;
  queueIndex: number;
  canPrev: boolean;
  canNext: boolean;
  onPrev: () => void;
  onNext: () => void;
}) {
  const CategoryIcon = getCategoryIcon(approval);
  return (
    <View style={styles.headerRow}>
      <View
        style={[styles.categoryIcon, { backgroundColor: accentColor }]}
        testID="approval-category-icon"
      >
        <CategoryIcon size={17} color="#ffffff" />
      </View>
      {queueLength > 1 ? (
        <QueueNavigator
          index={queueIndex}
          total={queueLength}
          canPrev={canPrev}
          canNext={canNext}
          onPrev={onPrev}
          onNext={onNext}
        />
      ) : null}
    </View>
  );
}

function QueueNavigator({
  index,
  total,
  canPrev,
  canNext,
  onPrev,
  onNext,
}: {
  index: number;
  total: number;
  canPrev: boolean;
  canNext: boolean;
  onPrev: () => void;
  onNext: () => void;
}) {
  const colors = useKitColors();
  return (
    <View style={styles.queueNavigator}>
      <Pressable
        accessibilityLabel="Previous approval"
        accessibilityRole="button"
        accessibilityState={{ disabled: !canPrev }}
        disabled={!canPrev}
        onPress={onPrev}
        style={[styles.queueButton, !canPrev ? styles.disabled : null]}
        testID="approval-queue-prev"
      >
        <ChevronLeft size={16} color={colors.textSecondary} />
      </Pressable>
      <Text style={[styles.queueLabel, { color: colors.textSecondary }]}>
        {index + 1} / {total}
      </Text>
      <Pressable
        accessibilityLabel="Next approval"
        accessibilityRole="button"
        accessibilityState={{ disabled: !canNext }}
        disabled={!canNext}
        onPress={onNext}
        style={[styles.queueButton, !canNext ? styles.disabled : null]}
        testID="approval-queue-next"
      >
        <ChevronRight size={16} color={colors.textSecondary} />
      </Pressable>
    </View>
  );
}

export function CallerRow({
  caller,
  attribution,
  canNavigate,
  onPress,
}: {
  caller: CallerInfo;
  attribution: ApprovalAttribution;
  canNavigate: boolean;
  onPress: () => void;
}) {
  const colors = useKitColors();
  const serverUrl = useKitServerUrl();
  const iconKind: MobileUnitIconKind =
    caller.kind === "browser"
      ? "browser"
      : caller.kind === "panel"
        ? "panel"
        : caller.kind === "client"
          ? "client"
          : caller.kind === "extension"
            ? "extension"
            : caller.kind === "system"
              ? "system"
              : "worker";
  const chip = (
    <View
      style={[
        styles.callerChip,
        {
          backgroundColor: colors.surfaceSunken,
          borderColor: colors.borderSubtle,
        },
      ]}
    >
      <MobileUnitIcon
        icon={caller.icon}
        source={caller.iconSourcePath}
        kind={iconKind}
        serverUrl={serverUrl}
        size={18}
        color={colors.textSecondary}
      />
      <Text
        numberOfLines={1}
        style={[styles.callerChipLabel, { color: colors.text }]}
      >
        {caller.label}
      </Text>
      {canNavigate ? <ArrowRight size={12} color={colors.accent} /> : null}
    </View>
  );
  return (
    <View style={styles.callerRow}>
      {canNavigate ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Show ${caller.kindLabel.toLowerCase()} ${caller.label}`}
          onPress={onPress}
          testID="approval-caller-chip"
          style={({ pressed }) => [pressed ? styles.pressed : null]}
        >
          {chip}
        </Pressable>
      ) : (
        <View testID="approval-caller-chip">{chip}</View>
      )}
      <Text style={[styles.callerRowLabel, { color: colors.textSecondary }]}>
        {caller.kindLabel.toLowerCase()}
      </Text>
      {attribution.target ? (
        <>
          <Text
            style={[styles.callerRowLabel, { color: colors.textSecondary }]}
          >
            {attribution.relation ?? "for"}
          </Text>
          <View
            style={[
              styles.callerChip,
              {
                backgroundColor: colors.surfaceSunken,
                borderColor: colors.borderSubtle,
              },
            ]}
          >
            <Text
              numberOfLines={1}
              style={[styles.callerChipLabel, { color: colors.text }]}
            >
              {attribution.target}
            </Text>
          </View>
        </>
      ) : null}
    </View>
  );
}

function getCategoryIcon(approval: PendingApproval): IconComponent {
  if (approval.kind === "capability") return ExternalLink;
  if (
    approval.kind === "client-config" ||
    approval.kind === "credential-input" ||
    approval.kind === "secret-input"
  )
    return Settings2;
  if (approval.kind === "device-code") return ExternalLink;
  return Lock;
}

export function WarningBand({ message }: { message: string }) {
  const colors = useKitColors();
  return (
    <View
      accessibilityRole="alert"
      style={[styles.warningBand, { backgroundColor: colors.dangerSoft }]}
    >
      <AlertTriangle size={14} color={colors.danger} />
      <View style={styles.markdownFlex}>
        <ApprovalMarkdown source={message} tone="danger" compact />
      </View>
    </View>
  );
}
