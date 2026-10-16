import { Pressable, StyleSheet, Text, View } from "react-native";
import type { IconComponent } from "../ui/icons";
import { useKitColors } from "../ui/theme";
import { radius, spacing, touchTarget, type } from "../ui/tokens";

/** One workspace in a list or drawer: its glyph, its name, one line about it. */
export function WorkspaceEntryRow({
  icon: Icon,
  title,
  subtitle,
  selected,
  accessibilityLabel,
  onPress,
  testID,
}: {
  icon: IconComponent;
  title: string;
  subtitle: string;
  selected: boolean;
  accessibilityLabel: string;
  onPress: () => void;
  testID?: string;
}) {
  const colors = useKitColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={styles.workspaceButton}
      {...(testID ? { testID } : {})}
    >
      <View
        style={[
          styles.icon,
          { backgroundColor: selected ? colors.accentSoft : colors.surfaceSunken },
        ]}
      >
        <Icon size={17} color={selected ? colors.accent : colors.textSecondary} />
      </View>
      <View style={styles.copy}>
        <Text numberOfLines={1} style={[type.bodyStrong, { color: colors.text }]}>
          {title}
        </Text>
        <Text style={[type.micro, { color: colors.textTertiary }]}>{subtitle}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  workspaceButton: {
    flex: 1,
    minWidth: 0,
    minHeight: touchTarget,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  icon: {
    width: 30,
    height: 30,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  copy: { flex: 1, minWidth: 0, gap: 2 },
});
