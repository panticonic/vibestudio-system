export type ModelState =
  | "ready"
  | "startable"
  | "not-installed"
  | "starting"
  | "downloading"
  | "error";

/** One row of `localModels.listModels()`, trimmed to what readiness needs. */
export type ModelRow = {
  /** The model's name within the local provider; its ref is `local:` plus the slug. */
  slug: string;
  displayName: string;
  /**
   * ready: running. startable: downloaded and healthy, not running. not-installed: offered but not downloaded.
   * starting / downloading: in progress, not usable yet. error: failed; see errorMessage.
   */
  state: ModelState;
  /** How well the machine runs it. too-big means it will not fit. */
  fit: {
    fit: "full-gpu" | "partial-offload" | "cpu-only" | "too-big";
    estTokensPerSec: number | null;
  };
  download: { progress: number; phase: "active" | "queued" | "paused" } | null;
  /** Why the model is in the error state; null otherwise. */
  errorMessage: string | null;
};

/**
 * What kind of failure an error message describes.
 * - download: fetching the model or the engine failed: HTTP errors, a size or checksum mismatch.
 * - storage: the disk refused: no space left, permission denied, a missing or unreadable file.
 * - memory: the machine ran out of memory loading or running the model.
 * - engine: the llama.cpp server failed to start, crashed, or failed its smoke test.
 * - unknown: none of these.
 */
export type FailureKind = "download" | "storage" | "memory" | "engine" | "unknown";

export type ModelReadiness = {
  /** `local:<slug>`, the ref agents and natlang use. */
  ref: string;
  state: ModelState;
  /** True when the model can serve a request now or by starting on demand: state is ready or startable. */
  usable: boolean;
  /** One line: progress, fit, or the failure, for the user. */
  detail: string;
  /** Set when state is error. */
  failure?: FailureKind;
};

export type Readiness = {
  models: ModelReadiness[];
  /** The model natlang programs run on, `local:lfm3-1.7b`. When it is not usable, natlang uses the hosted low-tier model, which is billed. */
  executor: { ref: string; usable: boolean; state: ModelState | "absent"; detail: string };
  /** The best usable model for agent tasks: local:qwen3.8-27b, then local:lfm3-1.7b, then local:lfm2.5-2.6b; null when none is usable. */
  preferred: string | null;
  /** What to tell or offer the user, one line each. Installing is only offered; it needs the user's request. */
  advice: string[];
};
