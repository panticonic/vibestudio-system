import type { ClientTrustChange, PendingApproval } from "@vibestudio/shared/approvals";

/**
 * The trust-change section of a capability approval
 * (docs/client-hosts-and-clients-plan.md §4.4.1, "Present").
 *
 * A publication that changes which clients hold device-level power arrives as a
 * critical, fresh, per-operation decision. The card says what the decision IS:
 * for each client, who it is, which powers it gains or loses in plain words, and
 * the exact version it is pinned to. Every kit renders this one structure; none
 * derives its own wording.
 */

export interface TrustChangePower {
  capability: string;
  /** The capability catalog's own plain-language summary. */
  summary: string;
}

export interface TrustChangeEntry {
  /** The client's source, its identity in the workspace. */
  source: string;
  name: string;
  icon?: string;
  runtime: ClientTrustChange["runtime"];
  /** The runtime in words a person uses ("Desktop app", "Mobile app", "Terminal app"). */
  runtimeLabel: string;
  /** One sentence naming the client and what happens to its power. */
  headline: string;
  gained: readonly TrustChangePower[];
  lost: readonly TrustChangePower[];
  /** "Pinned to <version>", or the honest statement that no version is known. */
  pinnedLine: string;
  version: string | null;
}

export interface TrustChangeSection {
  heading: string;
  /** What the decision is, once, above the entries. */
  summary: string;
  entries: readonly TrustChangeEntry[];
  /** The two section labels the entries use. */
  labels: { gained: string; lost: string };
  /** A trust change is approved once or refused; the section says so rather than offering more. */
  decisionNote: string;
}

const RUNTIME_LABEL: Record<ClientTrustChange["runtime"], string> = {
  web: "Desktop app",
  "react-native": "Mobile app",
  terminal: "Terminal app",
};

export const TRUST_CHANGE_COPY = {
  heading: "Device-level access change",
  labels: { gained: "Will be able to", lost: "Will no longer be able to" },
  decisionNote:
    "This is approved one time, for exactly this change. It is never remembered, and no standing permission can cover it.",
  summary: (count: number) =>
    count === 1
      ? "This changes what one app may do on this device."
      : `This changes what ${count} apps may do on this device.`,
  pinned: (version: string) => `Pinned to ${version}`,
  pinnedUnknown: "Pinned to the exact source state being published",
  headline: {
    gains: (name: string, runtime: string) => `${name} (${runtime}) gains device-level access`,
    loses: (name: string, runtime: string) => `${name} (${runtime}) loses device-level access`,
    both: (name: string, runtime: string) => `${name} (${runtime}) changes its device-level access`,
    none: (name: string, runtime: string) => `${name} (${runtime})`,
  },
} as const;

export type PendingTrustChangeApproval = Extract<PendingApproval, { kind: "capability" }> & {
  trustChange: ClientTrustChange[];
};

export function hasTrustChange(
  approval: PendingApproval | undefined
): approval is PendingTrustChangeApproval {
  return (
    approval?.kind === "capability" &&
    Array.isArray(approval.trustChange) &&
    approval.trustChange.length > 0
  );
}

function entryOf(change: ClientTrustChange): TrustChangeEntry {
  const runtimeLabel = RUNTIME_LABEL[change.runtime] ?? change.runtime;
  const copy = TRUST_CHANGE_COPY.headline;
  const headline =
    change.gained.length > 0 && change.lost.length > 0
      ? copy.both(change.title, runtimeLabel)
      : change.gained.length > 0
        ? copy.gains(change.title, runtimeLabel)
        : change.lost.length > 0
          ? copy.loses(change.title, runtimeLabel)
          : copy.none(change.title, runtimeLabel);
  return {
    source: change.source,
    name: change.title,
    ...(change.icon ? { icon: change.icon } : {}),
    runtime: change.runtime,
    runtimeLabel,
    headline,
    gained: change.gained.map(({ capability, summary }) => ({ capability, summary })),
    lost: change.lost.map(({ capability, summary }) => ({ capability, summary })),
    version: change.effectiveVersion,
    pinnedLine:
      change.effectiveVersion === null
        ? TRUST_CHANGE_COPY.pinnedUnknown
        : TRUST_CHANGE_COPY.pinned(change.effectiveVersion),
  };
}

/** The structured trust-change section of an approval, or `null` when it carries none. */
export function trustChangeSection(approval: PendingApproval): TrustChangeSection | null {
  if (!hasTrustChange(approval)) return null;
  return {
    heading: TRUST_CHANGE_COPY.heading,
    summary: TRUST_CHANGE_COPY.summary(approval.trustChange.length),
    entries: approval.trustChange.map(entryOf),
    labels: TRUST_CHANGE_COPY.labels,
    decisionNote: TRUST_CHANGE_COPY.decisionNote,
  };
}
