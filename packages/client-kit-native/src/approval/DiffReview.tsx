import { ChevronDown, ChevronRight } from "../ui/icons";
import { useKitColors } from "../ui/theme";
import { pressedOpacity } from "../ui/tokens";
import {
  type DiffReviewEntry,
  type DiffReviewFile,
} from "@vibestudio/shared/approvals";
import {
  allAdded,
  allRemoved,
  countLines,
  diffLines,
  type DiffRow,
  DiffTooLargeError,
  type LineDiffResult,
} from "@vibestudio/shared/lineDiff";
import { diffReviewPayloadHashes } from "@workspace/approvals-core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { ApprovalSheetProps } from "./ApprovalSheet";
import { styles } from "./styles";

const MOBILE_DIFF_CONTEXT_LINES = 3;
const MOBILE_DIFF_MAX_CHANGED_ROWS = 400;
const MOBILE_DIFF_MAX_COMPARISON_CELLS = 750_000;
const MOBILE_DIFF_MAX_DISPLAY_ROWS = 1_600;
type MobileDiffDisplayRow =
  | DiffRow
  | { type: "omitted"; count: number; key: string };

/** Preserve every changed line while folding long unchanged runs. */
function compactMobileDiffRows(
  rows: readonly DiffRow[],
): MobileDiffDisplayRow[] {
  const keep = new Set<number>();
  rows.forEach((row, index) => {
    if (row.type === "context") return;
    for (
      let nearby = Math.max(0, index - MOBILE_DIFF_CONTEXT_LINES);
      nearby <= Math.min(rows.length - 1, index + MOBILE_DIFF_CONTEXT_LINES);
      nearby += 1
    ) {
      keep.add(nearby);
    }
  });
  if (keep.size === 0) return rows.slice(0, MOBILE_DIFF_CONTEXT_LINES * 2 + 1);
  const result: MobileDiffDisplayRow[] = [];
  let index = 0;
  while (index < rows.length) {
    if (keep.has(index)) {
      const row = rows[index];
      if (!row) throw new Error(`Diff row ${index} is missing`);
      result.push(row);
      index += 1;
      continue;
    }
    const start = index;
    while (index < rows.length && !keep.has(index)) index += 1;
    result.push({
      type: "omitted",
      count: index - start,
      key: `${start}:${index}`,
    });
  }
  return result;
}

export function MobileDiffReview({
  approvalId,
  entries,
  fetchContent,
  onOpenFile,
}: {
  approvalId: string;
  entries: readonly DiffReviewEntry[];
  fetchContent?: ApprovalSheetProps["onFetchDiffContent"];
  onOpenFile?: ApprovalSheetProps["onOpenDiffFile"];
}) {
  const colors = useKitColors();
  const allowedHashes = useMemo(
    () => diffReviewPayloadHashes(entries),
    [entries],
  );
  const cache = useRef(new Map<string, string>());
  const inFlight = useRef(new Map<string, Promise<string>>());
  useEffect(() => {
    cache.current.clear();
    inFlight.current.clear();
  }, [approvalId]);
  const fetchPayloadContent = useCallback(
    async (hash: string) => {
      if (!allowedHashes.has(hash))
        throw new Error("This file is not part of the reviewed change.");
      const cached = cache.current.get(hash);
      if (cached !== undefined) return cached;
      const pending = inFlight.current.get(hash);
      if (pending) return pending;
      if (!fetchContent)
        throw new Error("File contents are unavailable on this client.");
      const request = fetchContent(approvalId, hash).then((text) => {
        if (text == null)
          throw new Error("This reviewed file is no longer available.");
        cache.current.set(hash, text);
        return text;
      });
      inFlight.current.set(hash, request);
      try {
        return await request;
      } finally {
        inFlight.current.delete(hash);
      }
    },
    [allowedHashes, approvalId, fetchContent],
  );
  const totals = entries.reduce(
    (sum, entry) => ({
      files: sum.files + entry.diffStat.filesChanged,
      insertions: sum.insertions + (entry.diffStat.insertions ?? 0),
      deletions: sum.deletions + (entry.diffStat.deletions ?? 0),
    }),
    { files: 0, insertions: 0, deletions: 0 },
  );
  const hasLineTotals = entries.every(
    (entry) => entry.diffStat.insertions != null,
  );
  return (
    <View
      style={[styles.mobileDiffReview, { borderColor: colors.border }]}
      testID="approval-diff-review"
    >
      <View style={styles.mobileDiffReviewHeading}>
        <View style={styles.mobileDiffReviewHeadingCopy}>
          <Text style={[styles.mobileDiffReviewTitle, { color: colors.text }]}>
            Review changes
          </Text>
          <Text
            style={[styles.mobileDiffMeta, { color: colors.textSecondary }]}
          >
            {totals.files} {totals.files === 1 ? "file" : "files"} ·{" "}
            {entries.length}{" "}
            {entries.length === 1 ? "repository" : "repositories"}
          </Text>
        </View>
        {hasLineTotals ? (
          <Text style={styles.mobileDiffCounts}>
            <Text style={{ color: colors.success }}>+{totals.insertions}</Text>
            <Text style={{ color: colors.textSecondary }}> · </Text>
            <Text style={{ color: colors.danger }}>−{totals.deletions}</Text>
          </Text>
        ) : null}
      </View>
      <Text style={[styles.mobileDiffHelp, { color: colors.textSecondary }]}>
        Open a repository, then a file, to inspect the exact reviewed change
        before deciding.
      </Text>
      <View style={styles.mobileDiffRepositories}>
        {entries.map((entry, index) => (
          <MobileDiffRepository
            key={`${entry.repoPath}:${entry.oldState}:${entry.newState ?? "deleted"}`}
            entry={entry}
            defaultOpen={index === 0}
            fetchContent={fetchPayloadContent}
            onOpenFile={onOpenFile}
          />
        ))}
      </View>
    </View>
  );
}

function MobileDiffRepository({
  entry,
  defaultOpen,
  fetchContent,
  onOpenFile,
}: {
  entry: DiffReviewEntry;
  defaultOpen: boolean;
  fetchContent: (hash: string) => Promise<string>;
  onOpenFile?: ApprovalSheetProps["onOpenDiffFile"];
}) {
  const colors = useKitColors();
  const [open, setOpen] = useState(defaultOpen);
  const counts =
    entry.diffStat.insertions == null
      ? ""
      : ` · +${entry.diffStat.insertions} −${entry.diffStat.deletions ?? 0}`;
  return (
    <View
      style={[
        styles.mobileDiffRepository,
        { borderColor: colors.borderSubtle },
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((value) => !value)}
        style={({ pressed }) => [
          styles.mobileDiffRepositoryHeader,
          {
            backgroundColor: colors.surfaceSunken,
            opacity: pressed ? pressedOpacity : 1,
          },
        ]}
        testID={`approval-diff-repo-${entry.repoPath}`}
      >
        {open ? (
          <ChevronDown size={16} color={colors.textSecondary} />
        ) : (
          <ChevronRight size={16} color={colors.textSecondary} />
        )}
        <View style={styles.mobileDiffRepositoryCopy}>
          <Text
            numberOfLines={2}
            style={[styles.mobileDiffRepositoryTitle, { color: colors.text }]}
          >
            {entry.repoPath}
          </Text>
          <Text
            style={[styles.mobileDiffMeta, { color: colors.textSecondary }]}
          >
            {entry.diffStat.filesChanged}{" "}
            {entry.diffStat.filesChanged === 1 ? "file" : "files"}
            {counts}
            {entry.truncated ? " · list truncated" : ""}
          </Text>
        </View>
      </Pressable>
      {open ? (
        <View style={styles.mobileDiffFiles}>
          {entry.changedFiles.map((file) => (
            <MobileDiffFile
              key={file.path}
              entry={entry}
              file={file}
              fetchContent={fetchContent}
              onOpenFile={onOpenFile}
            />
          ))}
          {entry.changedFiles.length === 0 ? (
            <Text
              style={[styles.mobileDiffHelp, { color: colors.textSecondary }]}
            >
              No file details were included.
            </Text>
          ) : null}
          {entry.truncated ? (
            <Text style={[styles.mobileDiffWarning, { color: colors.warning }]}>
              More files changed than this inline list can show. Use the full
              inspector for repository context.
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

type MobileFileDiffState =
  | { status: "idle" | "loading" }
  | { status: "ready"; result: LineDiffResult; rows: MobileDiffDisplayRow[] }
  | { status: "error"; message: string };

function MobileDiffFile({
  entry,
  file,
  fetchContent,
  onOpenFile,
}: {
  entry: DiffReviewEntry;
  file: DiffReviewFile;
  fetchContent: (hash: string) => Promise<string>;
  onOpenFile?: ApprovalSheetProps["onOpenDiffFile"];
}) {
  const colors = useKitColors();
  const degraded = Boolean(file.binary || file.tooLarge);
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<MobileFileDiffState>({ status: "idle" });
  useEffect(() => {
    if (!open || degraded) return;
    let cancelled = false;
    setState({ status: "loading" });
    void (async () => {
      try {
        const load = (hash: string | undefined, side: string) => {
          if (!hash)
            throw new Error(`The reviewed ${side} content hash is missing.`);
          return fetchContent(hash);
        };
        let result: LineDiffResult;
        if (file.kind === "added") {
          result = allAdded(await load(file.newHash, "new"));
        } else if (file.kind === "removed") {
          result = allRemoved(await load(file.oldHash, "old"));
        } else {
          const [oldText, newText] = await Promise.all([
            load(file.oldHash, "old"),
            load(file.newHash, "new"),
          ]);
          const oldLineCount = oldText === "" ? 0 : countLines(oldText);
          const newLineCount = newText === "" ? 0 : countLines(newText);
          if (oldLineCount * newLineCount > MOBILE_DIFF_MAX_COMPARISON_CELLS) {
            throw new DiffTooLargeError(
              "This file is too large to compare smoothly on a phone.",
            );
          }
          result = diffLines(oldText, newText);
        }
        if (
          result.insertions + result.deletions >
          MOBILE_DIFF_MAX_CHANGED_ROWS
        ) {
          throw new DiffTooLargeError(
            `This file changes ${result.insertions + result.deletions} lines, which is too much for a useful phone-sized inline diff.`,
          );
        }
        const rows = compactMobileDiffRows(result.rows);
        if (rows.length > MOBILE_DIFF_MAX_DISPLAY_ROWS) {
          throw new DiffTooLargeError(
            "This change is too spread out for a useful phone-sized inline diff.",
          );
        }
        if (!cancelled) setState({ status: "ready", result, rows });
      } catch (error) {
        if (!cancelled)
          setState({
            status: "error",
            message:
              error instanceof Error
                ? error.message
                : "Could not load this file diff.",
          });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [degraded, fetchContent, file.kind, file.newHash, file.oldHash, open]);
  const tone =
    file.kind === "added"
      ? [colors.success, colors.successSoft]
      : file.kind === "removed"
        ? [colors.danger, colors.dangerSoft]
        : [colors.warning, colors.warningSoft];
  const degradedMessage = file.binary
    ? "Binary file — inline text diff is not available."
    : file.tooLarge
      ? "This file is too large for an inline diff."
      : null;
  return (
    <View style={[styles.mobileDiffFile, { borderColor: colors.borderSubtle }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{
          disabled: degraded,
          expanded: degraded ? undefined : open,
        }}
        disabled={degraded}
        onPress={() => {
          if (open) {
            setOpen(false);
            return;
          }
          if (state.status === "error") setState({ status: "idle" });
          setOpen(true);
        }}
        style={styles.mobileDiffFileHeader}
        testID={`approval-diff-file-${file.path}`}
      >
        {degraded ? null : open ? (
          <ChevronDown size={15} color={colors.textSecondary} />
        ) : (
          <ChevronRight size={15} color={colors.textSecondary} />
        )}
        <Text
          style={[
            styles.mobileDiffKind,
            { color: tone[0], backgroundColor: tone[1] },
          ]}
        >
          {file.kind}
        </Text>
        <Text
          numberOfLines={2}
          style={[styles.mobileDiffFilePath, { color: colors.text }]}
        >
          {file.path}
        </Text>
      </Pressable>
      {degradedMessage ? (
        <MobileDiffFallback
          message={degradedMessage}
          file={file}
          entry={entry}
          onOpenFile={onOpenFile}
        />
      ) : null}
      {open ? (
        <View style={styles.mobileDiffFileBody}>
          {state.status === "idle" || state.status === "loading" ? (
            <View style={styles.mobileDiffLoading}>
              <ActivityIndicator size="small" color={colors.accent} />
              <Text
                style={[styles.mobileDiffHelp, { color: colors.textSecondary }]}
              >
                Loading reviewed content…
              </Text>
            </View>
          ) : state.status === "ready" ? (
            <>
              <Text
                style={[styles.mobileDiffMeta, { color: colors.textSecondary }]}
              >
                <Text style={{ color: colors.success }}>
                  +{state.result.insertions}
                </Text>
                {" · "}
                <Text style={{ color: colors.danger }}>
                  −{state.result.deletions}
                </Text>
                {" · unchanged context is folded"}
              </Text>
              <MobileDiffRows rows={state.rows} />
              {onOpenFile ? (
                <MobileOpenDiffFileButton
                  file={file}
                  entry={entry}
                  onOpenFile={onOpenFile}
                />
              ) : null}
            </>
          ) : state.status === "error" ? (
            <MobileDiffFallback
              message={state.message}
              file={file}
              entry={entry}
              onOpenFile={onOpenFile}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function MobileDiffRows({ rows }: { rows: readonly MobileDiffDisplayRow[] }) {
  const colors = useKitColors();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator
      style={styles.mobileDiffCodeScroll}
    >
      <View
        style={[
          styles.mobileDiffCode,
          { backgroundColor: colors.codeBackground },
        ]}
      >
        {rows.map((row, index) =>
          row.type === "omitted" ? (
            <Text
              key={row.key}
              style={[styles.mobileDiffOmitted, { color: colors.textTertiary }]}
            >
              ··· {row.count} unchanged {row.count === 1 ? "line" : "lines"} ···
            </Text>
          ) : (
            <View
              key={`${row.type}:${row.oldLineNo ?? ""}:${row.newLineNo ?? ""}:${index}`}
              style={[
                styles.mobileDiffCodeRow,
                {
                  backgroundColor:
                    row.type === "added"
                      ? colors.successSoft
                      : row.type === "removed"
                        ? colors.dangerSoft
                        : "transparent",
                },
              ]}
            >
              <Text
                style={[
                  styles.mobileDiffLineNumber,
                  { color: colors.textTertiary },
                ]}
              >
                {(row.type === "removed" ? row.oldLineNo : row.newLineNo) ?? ""}
              </Text>
              <Text
                style={[
                  styles.mobileDiffMarker,
                  {
                    color:
                      row.type === "added"
                        ? colors.success
                        : row.type === "removed"
                          ? colors.danger
                          : colors.textTertiary,
                  },
                ]}
              >
                {row.type === "added"
                  ? "+"
                  : row.type === "removed"
                    ? "−"
                    : " "}
              </Text>
              <Text
                selectable
                style={[styles.mobileDiffCodeText, { color: colors.text }]}
              >
                {row.text || " "}
              </Text>
            </View>
          ),
        )}
      </View>
    </ScrollView>
  );
}

function MobileDiffFallback({
  message,
  file,
  entry,
  onOpenFile,
}: {
  message: string;
  file: DiffReviewFile;
  entry: DiffReviewEntry;
  onOpenFile?: ApprovalSheetProps["onOpenDiffFile"];
}) {
  const colors = useKitColors();
  return (
    <View
      style={[
        styles.mobileDiffFallback,
        { backgroundColor: colors.warningSoft },
      ]}
    >
      <Text style={[styles.mobileDiffWarning, { color: colors.warning }]}>
        {message}
      </Text>
      {onOpenFile ? (
        <MobileOpenDiffFileButton
          file={file}
          entry={entry}
          onOpenFile={onOpenFile}
        />
      ) : null}
    </View>
  );
}

function MobileOpenDiffFileButton({
  file,
  entry,
  onOpenFile,
}: {
  file: DiffReviewFile;
  entry: DiffReviewEntry;
  onOpenFile: NonNullable<ApprovalSheetProps["onOpenDiffFile"]>;
}) {
  const colors = useKitColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${file.path} in the full file inspector`}
      onPress={() => void onOpenFile(file, entry)}
      style={({ pressed }) => [
        styles.mobileDiffOpenFile,
        { opacity: pressed ? pressedOpacity : 1 },
      ]}
      testID={`approval-diff-open-${file.path}`}
    >
      <Text style={[styles.mobileDiffOpenFileText, { color: colors.accent }]}>
        Open full file inspector
      </Text>
      <ChevronRight size={14} color={colors.accent} />
    </Pressable>
  );
}
