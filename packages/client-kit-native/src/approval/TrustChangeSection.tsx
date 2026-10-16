import { StyleSheet, Text, View } from "react-native";
import type {
  TrustChangeEntry,
  TrustChangeSection,
} from "@workspace/approvals-core";
import { AlertTriangle } from "../ui/icons";
import { MobileUnitIcon } from "../ui/MobileUnitIcon";
import { useKitColors, useKitServerUrl } from "../ui/theme";
import { radius, spacing, type as typeRamp } from "../ui/tokens";

/**
 * The structured trust-change section of a critical capability approval: which
 * clients gain or lose device-level power, in the catalog's own words, and the
 * exact build each is pinned to. Every word comes from the core's section model
 * (`trustChangeSection`); this only draws it.
 */
export function TrustChangeSectionView({
  section,
}: {
  section: TrustChangeSection;
}) {
  const colors = useKitColors();
  return (
    <View
      accessibilityRole="summary"
      style={[
        styles.section,
        { backgroundColor: colors.dangerSoft, borderColor: colors.danger },
      ]}
      testID="approval-trust-change"
    >
      <View style={styles.headingRow}>
        <AlertTriangle size={16} color={colors.danger} />
        <Text
          accessibilityRole="header"
          style={[typeRamp.bodyStrong, { color: colors.text }]}
          testID="approval-trust-change-heading"
        >
          {section.heading}
        </Text>
      </View>
      <Text style={[typeRamp.caption, { color: colors.textSecondary }]}>
        {section.summary}
      </Text>
      {section.entries.map((entry) => (
        <TrustChangeEntryView
          key={entry.source}
          entry={entry}
          labels={section.labels}
        />
      ))}
      <Text
        style={[typeRamp.caption, { color: colors.textSecondary }]}
        testID="approval-trust-change-note"
      >
        {section.decisionNote}
      </Text>
    </View>
  );
}

function TrustChangeEntryView({
  entry,
  labels,
}: {
  entry: TrustChangeEntry;
  labels: TrustChangeSection["labels"];
}) {
  const colors = useKitColors();
  const serverUrl = useKitServerUrl();
  return (
    <View
      style={[
        styles.entry,
        {
          backgroundColor: colors.surfaceRaised,
          borderColor: colors.borderSubtle,
        },
      ]}
      testID={`approval-trust-change-entry-${entry.source}`}
    >
      <View style={styles.entryHeader}>
        <MobileUnitIcon
          icon={entry.icon}
          source={entry.source}
          kind="client"
          serverUrl={serverUrl}
          size={22}
          color={colors.textSecondary}
        />
        <View style={styles.entryTitle}>
          <Text
            numberOfLines={1}
            style={[typeRamp.bodyStrong, { color: colors.text }]}
          >
            {entry.name}
          </Text>
          <Text style={[typeRamp.micro, { color: colors.textTertiary }]}>
            {entry.runtimeLabel}
          </Text>
        </View>
      </View>
      <Text style={[typeRamp.caption, { color: colors.text }]}>
        {entry.headline}
      </Text>
      {entry.gained.length > 0 ? (
        <PowerList
          label={labels.gained}
          powers={entry.gained}
          testID="gained"
        />
      ) : null}
      {entry.lost.length > 0 ? (
        <PowerList label={labels.lost} powers={entry.lost} testID="lost" />
      ) : null}
      <Text
        style={[typeRamp.micro, { color: colors.textTertiary }]}
        testID="approval-trust-change-pinned"
      >
        {entry.pinnedLine}
      </Text>
    </View>
  );
}

function PowerList({
  label,
  powers,
  testID,
}: {
  label: string;
  powers: TrustChangeEntry["gained"];
  testID: "gained" | "lost";
}) {
  const colors = useKitColors();
  return (
    <View style={styles.powers} testID={`approval-trust-change-${testID}`}>
      <Text style={[typeRamp.section, { color: colors.textSecondary }]}>
        {label}
      </Text>
      {powers.map((power) => (
        <Text
          key={power.capability}
          style={[typeRamp.body, { color: colors.text }]}
        >
          {`• ${power.summary}`}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  headingRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  entry: {
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.xs,
  },
  entryHeader: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  entryTitle: { flex: 1, minWidth: 0 },
  powers: { gap: spacing.xxs, marginTop: spacing.xs },
});
