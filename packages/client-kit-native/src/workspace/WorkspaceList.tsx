import { useSyncExternalStore } from "react";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import {
  workspaceEntries,
  workspaceListNotice,
  type WorkspaceModel,
} from "@workspace/workspace-core";
import { Workflow } from "../ui/icons";
import { useKitColors } from "../ui/theme";
import { radius, spacing, type } from "../ui/tokens";
import { WorkspaceEntryRow } from "./WorkspaceEntryRow";

/**
 * The workspaces a device may select, filterable and switchable, over a
 * `workspace-core` model: the current workspace first and marked, a notice where
 * the list would be while it loads, fails or is empty.
 */
export function WorkspaceList({
  model,
  onSwitched,
  onError,
}: {
  model: WorkspaceModel;
  /** The host accepted a switch. */
  onSwitched?: (workspaceId: string) => void;
  /** A switch failed; the model keeps the failure too. */
  onError?: (error: unknown) => void;
}) {
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot);
  const colors = useKitColors();
  const entries = workspaceEntries(state);
  const notice = workspaceListNotice(state);
  return (
    <View style={styles.container}>
      <TextInput
        accessibilityLabel="Filter workspaces"
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={model.setQuery}
        placeholder="Filter workspaces"
        placeholderTextColor={colors.textTertiary}
        style={[
          styles.filter,
          { backgroundColor: colors.surfaceSunken, color: colors.text, borderColor: colors.borderSubtle },
        ]}
        value={state.query}
      />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.entries}>
        {entries.map((entry) => (
          <WorkspaceEntryRow
            key={entry.id}
            icon={Workflow}
            title={entry.name}
            subtitle={
              state.switchingTo === entry.id ? "Switching…" : entry.current ? "Current" : "Workspace"
            }
            selected={entry.current}
            accessibilityLabel={`Open ${entry.name}`}
            testID={`workspace-entry-${entry.id}`}
            onPress={() => {
              model.switchTo(entry.id).then(
                () => onSwitched?.(entry.id),
                (error: unknown) => onError?.(error)
              );
            }}
          />
        ))}
        {notice ? (
          <Text
            accessibilityRole="alert"
            style={[type.caption, { color: colors.textSecondary }]}
          >
            {notice}
          </Text>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, gap: spacing.sm },
  filter: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    minHeight: 40,
  },
  entries: { gap: spacing.sm, paddingBottom: spacing.lg },
});
