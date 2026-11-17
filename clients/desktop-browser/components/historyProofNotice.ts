/**
 * What the title bar says about a panel's build history (tendrils plan §4.4).
 * The server marks each history entry's build proven once it starts, or failed
 * when it failed by its own code before ever starting; a failed newest entry is
 * gone back from automatically when an older entry is proven.
 */
export interface HistoryProofEntry {
  state: "unproven" | "proven" | "failed";
  failure?: unknown;
}

export interface HistoryProofNotice {
  title: string;
  detail: string | null;
}

/** `entries` is newest first, as `panelRuntime.historyProof` returns them. */
export function historyProofNotice(
  entries: readonly HistoryProofEntry[],
): HistoryProofNotice | null {
  const newest = entries[0];
  if (newest?.state !== "failed") return null;
  const detail = failureText(newest.failure);
  const title = entries.some((entry) => entry.state === "proven")
    ? "The latest update failed to start; showing the last working version"
    : "This page failed to start";
  return { title, detail };
}

function failureText(failure: unknown): string | null {
  if (typeof failure === "string") return failure;
  if (failure && typeof failure === "object") {
    const record = failure as Record<string, unknown>;
    for (const key of ["message", "detail", "code"]) {
      if (typeof record[key] === "string") return record[key];
    }
  }
  return null;
}
