import type { PendingApproval } from "@vibestudio/shared/approvals";
import {
  clearableRows,
  installRowHeadline,
  partNotableLine,
  type InstallReviewOrigin,
  type InstallReviewPart,
  type TemplateAcceptance,
} from "@vibestudio/shared/authority/unitInstallReview";
import { HOST_APPROVAL_COPY } from "@vibestudio/shared/hostApprovalCopy";

/** A `unit-install-review` approval, narrowed the same way every surface narrows it. */
export type PendingUnitInstallReviewApproval = Extract<
  PendingApproval,
  { kind: "unit-install-review" }
>;

/**
 * Per-part cleared row keys (selecting means allow now, deselecting means ask
 * when needed).
 *
 * `undefined` where a selection is optional means the platform's own default
 * acceptance: every part checked, every install-clearable row that is offered
 * by default checked (one click adds the complete slate).
 */
export type InstallSelection = ReadonlyMap<string, ReadonlySet<string>>;

const COPY = HOST_APPROVAL_COPY.installReview;

/** Beyond three changes a row states how many more there are; it never just stops. */
const DIFFERENTIAL_LINE_LIMIT = 3;

/** One click adds the complete slate: every part, every row offered by default. */
export function defaultInstallSelection(
  parts: readonly InstallReviewPart[]
): Map<string, Set<string>> {
  return new Map(
    parts
      .filter((part) => part.change !== "removed")
      .map((part) => [
        part.identityKey,
        new Set(
          clearableRows(part)
            .filter((row) => row.selectedByDefault)
            .map((row) => row.key)
        ),
      ])
  );
}

/**
 * The effective cleared set for a part: the controlled selection when a host
 * has one, or the platform's own default when it has not.
 */
export function selectedRowKeys(
  part: InstallReviewPart,
  selection: InstallSelection | undefined
): ReadonlySet<string> {
  if (selection) return selection.get(part.identityKey) ?? new Set();
  return new Set(
    clearableRows(part)
      .filter((row) => row.selectedByDefault)
      .map((row) => row.key)
  );
}

/**
 * The identity of a review's *offer*: which parts, how each changes, and which
 * rows each one puts on screen with which default. A refreshed snapshot that
 * changes any of those has changed what a selection can legally name.
 */
export function installOfferSignature(parts: readonly InstallReviewPart[]): string {
  return JSON.stringify(
    parts.map((part) => [
      part.identityKey,
      part.change,
      clearableRows(part).map((row) => [row.key, row.selectedByDefault]),
    ])
  );
}

/**
 * Re-seat a selection on a refreshed snapshot.
 *
 * The user's choices survive by identity key, because a snapshot refresh is not
 * a new decision. A row the new snapshot no longer offers is dropped (naming it
 * would have the server reject the whole acceptance), and a row that appears for
 * the first time in a part the user has already worked on stays unchecked,
 * because this decision may only clear what was actually on screen.
 */
export function syncInstallSelection(
  parts: readonly InstallReviewPart[],
  previous: InstallSelection
): Map<string, Set<string>> {
  const next = defaultInstallSelection(parts);
  for (const part of parts) {
    const prior = previous.get(part.identityKey);
    if (!prior || !next.has(part.identityKey)) continue;
    const offered = new Set(clearableRows(part).map((row) => row.key));
    next.set(part.identityKey, new Set([...prior].filter((key) => offered.has(key))));
  }
  return next;
}

/**
 * A selection as the `TemplateAcceptance` the server expects. Falls back to the
 * platform's default acceptance when no selection was made.
 */
export function installAcceptanceFrom(
  approval: PendingUnitInstallReviewApproval,
  selection: InstallSelection | undefined
): TemplateAcceptance {
  const decision =
    approval.mode === "update"
      ? "update"
      : approval.mode === "adopt-root"
        ? "adopt-root"
        : "install";
  const effective = selection ?? defaultInstallSelection(approval.parts);
  return {
    decision,
    allowNow: approval.parts
      .filter((part) => part.change !== "removed")
      .map((part) => ({
        identityKey: part.identityKey,
        permissions: [...(effective.get(part.identityKey) ?? new Set<string>())],
      })),
  };
}

/**
 * Whether this review is a diff rather than a footprint. Driven by the data, not
 * the mode string: an install and a first adoption have nothing to diff against,
 * so they are never differential no matter what marks ride along.
 */
export function isDifferentialReview(approval: PendingUnitInstallReviewApproval): boolean {
  if (approval.mode === "install" || approval.mode === "adopt-root") return false;
  return approval.parts.some(
    (part) =>
      part.change === "changed" ||
      part.change === "removed" ||
      [...part.notableRows, ...part.everydayRows].some((row) => row.change !== undefined)
  );
}

/**
 * What changed about what a part can do, on one line: at most three changes and
 * the count of the rest. A part that carries no change marks says so.
 */
export function differentialLine(part: InstallReviewPart): string {
  const changed = [...part.notableRows, ...part.everydayRows].filter((row) => row.change);
  if (changed.length === 0) return COPY.noNewPermissions;
  const shown = changed
    .slice(0, DIFFERENTIAL_LINE_LIMIT)
    .map((row) => `${row.change === "removed" ? "−" : "+"} ${installRowHeadline(row)}`);
  const rest = changed.length - shown.length;
  return [...shown, ...(rest > 0 ? [COPY.moreChanges(rest)] : [])].join(" · ");
}

/**
 * One line for a part in a list: the diff when the part's own rows carry change
 * marks, otherwise its ordinary footprint line. Driven by the rows, not by the
 * review's mode.
 */
export function installPartSummaryLine(part: InstallReviewPart): string {
  const marked = [...part.notableRows, ...part.everydayRows].some((row) => row.change);
  return marked ? differentialLine(part) : partNotableLine(part);
}

/** `installPartSummaryLine`, lower-cased to continue a sentence. */
export function installPartSummaryFragment(part: InstallReviewPart): string {
  const summary = installPartSummaryLine(part);
  return summary.length === 0 ? summary : `${summary[0]?.toLowerCase() ?? ""}${summary.slice(1)}`;
}

/**
 * Where a part's bytes came from. Only the origin URL is allowed here, never a
 * version, a kind label or the template's self-given name; the host's own build
 * is the one thing worth naming, since its identity ships in the build.
 */
export function installOriginLabel(origin: InstallReviewOrigin): string {
  if (origin.originStatus === "multiple-template-contributors") {
    return "Multiple template contributions";
  }
  if (origin.originStatus === "unresolved") return "";
  if (origin.url) return origin.url;
  if (origin.isHostBuild) return origin.version ? `Vibestudio ${origin.version}` : "Vibestudio";
  return origin.originKey;
}

/** The review's heading in the host's words. */
export function installReviewHeading(approval: PendingUnitInstallReviewApproval): string {
  const heading = COPY.heading;
  switch (approval.mode) {
    case "adopt-root":
      return heading["adopt-root"];
    case "install":
      return heading.install(approval.template?.title ?? approval.title);
    case "update":
      return heading.update(approval.template?.title ?? approval.title);
    case "remove":
      return heading.remove(approval.template?.title ?? approval.title);
    case "part-changed":
      return heading["part-changed"](approval.parts[0]?.title ?? approval.title);
  }
}
