export type LocalTaskState =
  | "ready"
  | "startable"
  | "not-installed"
  | "starting"
  | "downloading"
  | "error";
export type LocalTaskInventoryRow = {
  ref: string;
  state: LocalTaskState;
  fit: "full-gpu" | "partial-offload" | "cpu-only" | "too-big";
  toolsCapable: boolean;
  contextWindow: number;
  progress: number | null;
  errorMessage: string | null;
};
export type LocalTaskRequest = {
  goal: string;
  modelRef: string;
  operation: "inspect" | "prepare" | "delegate";
  mayInstall: boolean;
  needsTools: boolean;
  minimumContext: number;
  requiresPriorConversation: boolean;
};
export type LocalTaskDisposition =
  | "usable"
  | "unavailable"
  | "wait-for-progress"
  | "needs-install"
  | "too-big"
  | "catalog-error"
  | "needs-install-confirmation"
  | "installation-rejected"
  | "installation-unverified"
  | "unsupported-tools"
  | "context-too-small"
  | "ready-to-delegate";
export type LocalTaskReceipt =
  | { kind: "installed"; ref: string; jobId: string }
  | { kind: "validated-existing"; ref: string }
  | { kind: "state-changed"; ref: string };
export type LocalTaskObservation = {
  row: LocalTaskInventoryRow | null;
  disposition: LocalTaskDisposition;
};
export type LocalTaskReport = {
  disposition: LocalTaskDisposition;
  ref: string;
  state: LocalTaskState | null;
  receipt: LocalTaskReceipt | null;
  handoff: { ref: string; mode: "fresh" | "fork" } | null;
};
