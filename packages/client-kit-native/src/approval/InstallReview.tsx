import { MobileUnitIcon } from "../ui/MobileUnitIcon";
import { ChevronDown, ChevronRight, Globe } from "../ui/icons";
import { useKitColors, useKitServerUrl } from "../ui/theme";
import { pressedOpacity } from "../ui/tokens";
import type { PendingUnitInstallReviewApproval } from "@vibestudio/shared/approvals";
import {
  clearableRows,
  compareInstallParts,
  groupInstallParts,
  groupRowsByDomain,
  INSTALL_BEHAVIOR_COPY,
  INSTALL_ROW_TIMING_COPY,
  type InstallPartGroup,
  installPartGroupCount,
  type InstallReviewPart,
  type InstallReviewRow,
  installRowHeadline,
} from "@vibestudio/shared/authority/unitInstallReview";
import { HOST_APPROVAL_COPY } from "@vibestudio/shared/hostApprovalCopy";
import {
  installOriginLabel,
  installPartSummaryFragment,
  installPartSummaryLine,
} from "@workspace/approvals-core";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { DetailRow } from "./details";
import { styles } from "./styles";

/** Beyond five, Worth knowing folds — a threshold, never a cap. Nothing is dropped. */
const NOTABLE_COLLAPSE_THRESHOLD = 5;
/** Search appears above this many template parts, and is absent below it (§7.2). */
const SEARCH_THRESHOLD = 12;

/**
 * The install review, as a full-screen mobile route (§7.2, §7.8).
 *
 * Same server-owned decision, same rows, same copy, same selection semantics as
 * desktop — responsive presentation must not produce a weaker review anywhere.
 * List and detail are separate navigation levels here; the back gesture never
 * submits and never silently discards.
 */
export function InstallReviewDetails({
  approval,
  selection,
  onTogglePart,
  onToggleRow,
}: {
  approval: PendingUnitInstallReviewApproval;
  selection: ReadonlyMap<string, ReadonlySet<string>>;
  onTogglePart: (part: InstallReviewPart, checked: boolean) => void;
  onToggleRow: (
    part: InstallReviewPart,
    rowKey: string,
    checked: boolean,
  ) => void;
}) {
  const colors = useKitColors();
  const copy = HOST_APPROVAL_COPY.installReview;
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState("");
  const [groupExpansion, setGroupExpansion] = useState<Map<string, boolean>>(
    () => new Map(),
  );

  // One comparator, shared with the desktop list (§7.8): a differential review
  // leads with what changed, a first encounter leads with what is worth
  // knowing. Sorting by title alone scattered the handful of parts that have
  // something to say through fifty that read `Nothing unusual`, and on a phone
  // — where the list is one column and the fold is four rows down — that is
  // where a notable part goes to be missed.
  const sortedParts = useMemo(
    () =>
      [...approval.parts].sort((left, right) =>
        compareInstallParts(approval.mode, left, right),
      ),
    [approval.parts, approval.mode],
  );
  // A repair touches units the template does not own (§5.3): it is never mixed
  // into the template's own list and never folded away.
  const templateParts = sortedParts.filter(
    (part) => part.section === "template",
  );
  const repairParts = sortedParts.filter((part) => part.section === "repair");
  const needle = query.trim().toLowerCase();
  const filtersShown = templateParts.length > SEARCH_THRESHOLD;
  const kinds = useMemo(
    () => [...new Set(templateParts.map((part) => part.label))].sort(),
    [templateParts],
  );
  const visibleParts = filtersShown
    ? templateParts.filter(
        (part) =>
          (kindFilter === "" || part.label === kindFilter) &&
          (needle === "" ||
            part.title.toLowerCase().includes(needle) ||
            part.purpose.toLowerCase().includes(needle)),
      )
    : templateParts;
  const groups = groupInstallParts(visibleParts);
  const anythingNotable = templateParts.some(
    (part) => part.notableRows.length > 0,
  );
  const filtering = filtersShown && (needle !== "" || kindFilter !== "");
  const groupIsOpen = (group: InstallPartGroup): boolean => {
    if (filtering) return true;
    const explicit = groupExpansion.get(group.key);
    if (explicit !== undefined) return explicit;
    return !(anythingNotable && !group.hasNotablePart);
  };
  const hiddenByFilter = templateParts.length - visibleParts.length;
  const hiddenAllowed = templateParts.filter(
    (part) =>
      !visibleParts.includes(part) &&
      (selection.get(part.identityKey)?.size ?? 0) > 0,
  ).length;

  // An upgrade that changes nothing about what any part can do is one line —
  // and the sheet header already carries it.
  if (approval.parts.length === 0 && approval.unchangedPartCount > 0)
    return null;

  return (
    <>
      <Text style={[styles.helperText, { color: colors.textSecondary }]}>
        {copy.adds(approval.summary)}
      </Text>
      {filtersShown ? (
        <View style={styles.installReviewFilters}>
          <TextInput
            accessibilityLabel={copy.filters.search}
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setQuery}
            placeholder={copy.filters.search}
            placeholderTextColor={colors.textTertiary}
            style={[
              styles.input,
              {
                backgroundColor: colors.surfaceSunken,
                borderColor: colors.border,
                color: colors.text,
              },
            ]}
            testID="install-review-search"
            value={query}
          />
          <ScrollView
            horizontal
            contentContainerStyle={styles.installReviewKindFilters}
            keyboardShouldPersistTaps="handled"
            showsHorizontalScrollIndicator={false}
          >
            {["", ...kinds].map((kind) => {
              const selected = kindFilter === kind;
              const label = kind || copy.filters.allKinds;
              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`${copy.filters.kind}: ${label}`}
                  key={kind || "all"}
                  onPress={() => setKindFilter(kind)}
                  style={({ pressed }) => [
                    styles.installReviewKindFilter,
                    {
                      backgroundColor: selected
                        ? colors.accentSoft
                        : colors.surfaceSunken,
                      borderColor: selected ? colors.accent : colors.border,
                      opacity: pressed ? pressedOpacity : 1,
                    },
                  ]}
                  testID={`install-review-kind-${kind || "all"}`}
                >
                  <Text
                    style={[
                      styles.installReviewKindFilterText,
                      {
                        color: selected ? colors.accent : colors.textSecondary,
                      },
                    ]}
                  >
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      ) : null}
      <View style={styles.installReviewGroups}>
        {groups.map((group) => {
          const open = groupIsOpen(group);
          return (
            <View
              key={group.key}
              style={[
                styles.installReviewGroup,
                { borderColor: colors.borderSubtle },
              ]}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: filtering, expanded: open }}
                accessibilityLabel={`${group.title}. ${installPartGroupCount(group)} parts. ${group.parts
                  .map(
                    (part) =>
                      `${part.title}: ${installPartSummaryFragment(part)}`,
                  )
                  .join(". ")}`}
                disabled={filtering}
                onPress={() =>
                  setGroupExpansion((previous) => {
                    const next = new Map(previous);
                    next.set(group.key, !open);
                    return next;
                  })
                }
                style={({ pressed }) => [
                  styles.installReviewGroupHeader,
                  {
                    backgroundColor: colors.surfaceSunken,
                    opacity: pressed ? pressedOpacity : 1,
                  },
                ]}
                testID={`install-review-group-${group.key}`}
              >
                <View style={styles.installReviewGroupTitleRow}>
                  <Text
                    style={[
                      styles.installReviewGroupTitle,
                      { color: colors.text },
                    ]}
                  >
                    {group.title}
                  </Text>
                  <View
                    style={[
                      styles.installReviewGroupBadge,
                      { backgroundColor: colors.surfaceSunken },
                    ]}
                  >
                    <Text
                      style={[
                        styles.installReviewGroupBadgeText,
                        { color: colors.textSecondary },
                      ]}
                    >
                      {installPartGroupCount(group)}
                    </Text>
                  </View>
                  {open ? (
                    <ChevronDown size={16} color={colors.textSecondary} />
                  ) : (
                    <ChevronRight size={16} color={colors.textSecondary} />
                  )}
                </View>
              </Pressable>
              {open ? (
                <View style={styles.installReviewGroupParts}>
                  {group.parts.map((part) => (
                    <InstallReviewPartRow
                      key={part.identityKey}
                      part={part}
                      mode={approval.mode}
                      selected={selection.get(part.identityKey) ?? new Set()}
                      onTogglePart={(checked) => onTogglePart(part, checked)}
                      onToggleRow={(rowKey, checked) =>
                        onToggleRow(part, rowKey, checked)
                      }
                    />
                  ))}
                </View>
              ) : null}
            </View>
          );
        })}
      </View>
      {hiddenByFilter > 0 ? (
        // A filter narrows what's on screen, never what's granted. Everything
        // it hides is still selected exactly as it was and still gets installed.
        <Text style={[styles.helperText, { color: colors.textSecondary }]}>
          {copy.filters.hidden(hiddenByFilter, hiddenAllowed)}
        </Text>
      ) : null}
      {approval.unchangedPartCount > 0 ? (
        <Text style={[styles.helperText, { color: colors.textSecondary }]}>
          {copy.summary.unchangedParts(approval.unchangedPartCount)}
        </Text>
      ) : null}
      {repairParts.length > 0 ? (
        <View style={styles.detailsBlock} testID="install-review-repairs">
          <Text style={[styles.detailsSummaryText, { color: colors.text }]}>
            {copy.sections.repairs(repairParts.length)}
          </Text>
          {repairParts.map((part) => (
            <InstallReviewPartRow
              key={part.identityKey}
              part={part}
              mode={approval.mode}
              selected={selection.get(part.identityKey) ?? new Set()}
              onTogglePart={(checked) => onTogglePart(part, checked)}
              onToggleRow={(rowKey, checked) =>
                onToggleRow(part, rowKey, checked)
              }
            />
          ))}
        </View>
      ) : null}
    </>
  );
}

function InstallReviewPartRow({
  part,
  mode,
  selected,
  onTogglePart,
  onToggleRow,
}: {
  part: InstallReviewPart;
  mode: PendingUnitInstallReviewApproval["mode"];
  selected: ReadonlySet<string>;
  onTogglePart: (checked: boolean) => void;
  onToggleRow: (rowKey: string, checked: boolean) => void;
}) {
  const colors = useKitColors();
  const serverUrl = useKitServerUrl();
  const [open, setOpen] = useState(false);
  const clearable = clearableRows(part);
  const allSelected =
    clearable.length > 0 && clearable.every((row) => selected.has(row.key));
  const noneSelected = clearable.every((row) => !selected.has(row.key));
  const copy = HOST_APPROVAL_COPY.installReview;

  return (
    <View style={styles.detailsBlock}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${part.title}, ${part.label}. ${installPartSummaryLine(part)}`}
        onPress={() => setOpen((current) => !current)}
        style={styles.detailsSummary}
        testID={`install-review-part-${part.identityKey}`}
      >
        {open ? (
          <ChevronDown size={14} color={colors.textSecondary} />
        ) : (
          <ChevronRight size={14} color={colors.textSecondary} />
        )}
        <MobileUnitIcon
          icon={part.icon}
          source={part.repoPath}
          iconState={part.iconState}
          kind={
            part.kind === "panel"
              ? "panel"
              : part.kind === "client"
                ? "client"
                : part.kind === "extension"
                  ? "extension"
                  : "worker"
          }
          serverUrl={serverUrl}
          size={20}
          color={colors.textSecondary}
        />
        <View style={styles.unitReviewSummary}>
          <Text style={[styles.detailsSummaryText, { color: colors.text }]}>
            {part.title} · {part.label}
          </Text>
          {part.purpose ? (
            <Text
              style={[styles.unitReviewChange, { color: colors.textSecondary }]}
            >
              {part.purpose}
            </Text>
          ) : null}
          <Text
            style={[styles.unitReviewChange, { color: colors.textSecondary }]}
          >
            {mode === "update" && part.change === "added" ? "New · " : ""}
            {installPartSummaryLine(part)}
          </Text>
        </View>
      </Pressable>
      {clearable.length > 0 && part.change !== "removed" ? (
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: allSelected }}
          accessibilityLabel={`Allow ${part.title} now`}
          onPress={() => onTogglePart(!allSelected)}
          style={styles.detailsSummary}
        >
          <Text
            style={[styles.unitReviewChange, { color: colors.textSecondary }]}
          >
            {allSelected
              ? "Allowed now"
              : noneSelected
                ? copy.willAsk
                : "Allowed now, except what you unchecked"}
          </Text>
        </Pressable>
      ) : null}
      {open ? (
        <InstallReviewPartDetail
          part={part}
          selected={selected}
          onToggleRow={onToggleRow}
        />
      ) : null}
    </View>
  );
}

/**
 * The notable/everyday split (§7.2, §10): Worth knowing carries every headline
 * row and every behavioral fact, collapsing behind a disclosure only past five
 * — never dropping one — and auto-expanded whenever something here always
 * confirms, because that is the one row a person must not miss behind a tap.
 * The ordinary machinery of the part folds behind its own count, with the
 * shared honesty line attached only once it is opened.
 */
function InstallReviewPartDetail({
  part,
  selected,
  onToggleRow,
}: {
  part: InstallReviewPart;
  selected: ReadonlySet<string>;
  onToggleRow: (rowKey: string, checked: boolean) => void;
}) {
  const colors = useKitColors();
  const copy = HOST_APPROVAL_COPY.installReview;
  const [showAllNotable, setShowAllNotable] = useState(false);
  const [showEveryday, setShowEveryday] = useState(false);

  const notable = part.notableRows;
  const hasCritical = notable.some((row) => row.timing === "asks-every-time");
  const collapsed =
    notable.length > NOTABLE_COLLAPSE_THRESHOLD &&
    !showAllNotable &&
    !hasCritical;
  const shownNotable = collapsed
    ? notable.slice(0, NOTABLE_COLLAPSE_THRESHOLD)
    : notable;

  return (
    <View style={styles.detailRows}>
      {notable.length > 0 ? (
        <View style={styles.detailsBlock}>
          <View style={styles.detailRows}>
            {shownNotable.map((row) => (
              <InstallReviewRowLine
                key={row.key}
                row={row}
                checked={selected.has(row.key)}
                onToggle={(checked) => onToggleRow(row.key, checked)}
              />
            ))}
          </View>
          {collapsed ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={copy.sections.showAllNotable(notable.length)}
              onPress={() => setShowAllNotable(true)}
              style={styles.disclosureButton}
            >
              <Text
                style={[styles.disclosureButtonText, { color: colors.accent }]}
              >
                {copy.sections.showAllNotable(notable.length)}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {part.everydayRows.length > 0 ? (
        <View style={styles.detailsBlock}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: showEveryday }}
            accessibilityLabel={copy.sections.everyday(
              part.everydayRows.length,
            )}
            onPress={() => setShowEveryday((open) => !open)}
            style={styles.disclosureButton}
          >
            <ChevronDown size={12} color={colors.accent} />
            <Text
              style={[styles.disclosureButtonText, { color: colors.accent }]}
            >
              {copy.sections.everyday(part.everydayRows.length)}
            </Text>
          </Pressable>
          {showEveryday ? (
            <View style={styles.detailRows}>
              <Text
                style={[
                  styles.unitReviewChange,
                  { color: colors.textSecondary },
                ]}
              >
                {copy.sections.everydayFraming}
              </Text>
              {/* Grouped by domain (§7.2), same as the desktop detail. Nine
                  ordinary rows in a flat column are nine things to read on a
                  phone; under `Files`, `The web`, `Your workspace` they are
                  three, and the grouping is what makes "ordinary" legible
                  rather than merely long. */}
              {groupRowsByDomain(part.everydayRows).map((group) => (
                <View key={group.label} style={styles.detailRows}>
                  <Text
                    style={[
                      styles.unitReviewChange,
                      { color: colors.textSecondary, fontWeight: "600" },
                    ]}
                  >
                    {group.label}
                  </Text>
                  {group.rows.map((row) => (
                    <InstallReviewRowLine
                      key={row.key}
                      row={row}
                      checked={selected.has(row.key)}
                      onToggle={(checked) => onToggleRow(row.key, checked)}
                    />
                  ))}
                </View>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}
      {/* Identity at human scale: origin URL, never a version, kind label, or
          digest in this slot (§7.6.3). */}
      <DetailRow
        icon={Globe}
        label="From"
        value={installOriginLabel(part.origin)}
        emphasizeOrigin={part.origin}
      />
      {/* The emphasis above is visual only, so the same fact is also stated in
          words — this row's accessibility label is exactly `originDomainFact`,
          the string the terminal form prints. */}
      {part.origin.registrableDomain && !part.origin.isHostBuild ? (
        <DetailRow
          icon={Globe}
          label="Domain"
          value={part.origin.registrableDomain}
        />
      ) : null}
      {part.originallyInstalledFrom ? (
        <DetailRow
          icon={Globe}
          label="Originally installed from"
          value={part.originallyInstalledFrom}
        />
      ) : null}
    </View>
  );
}

function InstallReviewRowLine({
  row,
  checked,
  onToggle,
}: {
  row: InstallReviewRow;
  checked: boolean;
  onToggle: (checked: boolean) => void;
}) {
  const colors = useKitColors();
  const headline = installRowHeadline(row);
  const detail =
    row.kind === "behavior"
      ? INSTALL_BEHAVIOR_COPY[row.fact].detail
      : row.row.resource;
  const timing = INSTALL_ROW_TIMING_COPY[row.timing];

  // Contextual and critical rows carry no checkbox — this decision cannot grant
  // them, and their timing line carries the whole meaning.
  const body = (
    <View style={styles.unitReviewSummary}>
      <Text style={[styles.detailsSummaryText, { color: colors.text }]}>
        {row.change === "added" ? "+ " : row.change === "removed" ? "− " : ""}
        {headline}
      </Text>
      <Text style={[styles.unitReviewChange, { color: colors.textSecondary }]}>
        {detail}
      </Text>
      {timing ? (
        <Text
          style={[styles.unitReviewChange, { color: colors.textSecondary }]}
        >
          {timing}
        </Text>
      ) : null}
    </View>
  );

  if (!row.selectable) return <View style={styles.detailsSummary}>{body}</View>;
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={`Allow ${headline} now`}
      onPress={() => onToggle(!checked)}
      style={styles.detailsSummary}
    >
      <Text style={[styles.detailsSummaryText, { color: colors.text }]}>
        {checked ? "☑" : "☐"}
      </Text>
      {body}
    </Pressable>
  );
}
