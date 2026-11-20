/** One captured host log line, as `serverLog.tail` and `serverLog.query` return it. */
export type LogRecord = {
  /** Sequence number within this server boot; the cursor for citing and catching up. */
  seq: number;
  /** Epoch milliseconds when the line was captured. */
  timestamp: number;
  level: "verbose" | "info" | "warn" | "error";
  /** Subsystem tag from the conventional `[Tag]` prefix. */
  tag?: string;
  /** The message; a multi-line message keeps its newlines. */
  message: string;
  pid: number;
};

/** A query over the log. Supply both sequence bounds for a fixed window. */
export type LogRequest = {
  /** Epoch milliseconds: only lines captured at or after this time. Omit for the newest lines. */
  since?: number;
  /** Lowest level to read. Omit to read every level. */
  level?: "verbose" | "info" | "warn" | "error";
  bounds?: LogSequenceRange;
  tag?: string;
};

/** What the service returned for one request, trimmed to what the brief needs. */
export type LogSnapshot = {
  /** Identifies this server boot; any cursor from an earlier boot is invalid. */
  serverBootId: string;
  /** Highest seq captured so far by the server, not only in `records`. */
  latestSeq: number;
  /** The records read, ascending by seq. */
  records: LogRecord[];
  /** How many lines the server has captured this boot, for scale. */
  totalCaptured: number;
};

/** Lines that say the same thing, collapsed. Numbers, identifiers, quoted text and bracketed names are ignored when comparing messages. */
export type LogGroup = {
  /** Position in the list of groups, from 0. */
  id: number;
  level: "verbose" | "info" | "warn" | "error";
  tag?: string;
  /** The message of the first line of the group, cut to 300 characters. */
  message: string;
  /** Exact number of lines in the group. */
  count: number;
  /** The first sequence number of the group. */
  firstSeq: number;
  /** The last sequence number of the group. */
  lastSeq: number;
};

/**
 * What a group of log lines means for the workspace server.
 * - routine: expected lifecycle or known benign noise; needs no attention.
 * - notable: a degradation or oddity that the server recovered from or kept running through.
 * - failure: an operation failed, was refused, crashed, or left something unusable.
 */
export type LogClass = "routine" | "notable" | "failure";

/** One group of lines worth the reader's attention, with the evidence to find it again. */
export type Finding = {
  class: "notable" | "failure";
  level: "verbose" | "info" | "warn" | "error";
  tag?: string;
  /** The first line of the group, quoted as captured. */
  message: string;
  count: number;
  firstSeq: number;
  lastSeq: number;
};

/** The brief the agent reports from. Every sequence number is a real line of `serverBootId`. */
export type LogBrief = {
  /** Copy into any report so the evidence can be found again. */
  serverBootId: string;
  latestSeq: number;
  /** Which lines were read: the first and last seq, and how many. */
  window: { fromSeq: number; toSeq: number; records: number };
  /** incident when any finding is a failure, attention when any is notable, otherwise normal. */
  status: "normal" | "attention" | "incident";
  /** One line of counts: how many failures and notable groups were found in how many lines. */
  headline: string;
  /** The groups that are not routine, failures first. */
  findings: Finding[];
};

export type ServerLogCursorRequest = { operationId: string; goal: string };
export type ServerLogCursor = { serverBootId: string; seq: number };
export type ServerLogCursorWindow = {
  saved: ServerLogCursor;
  liveBoot: string;
  oldestSeq: number | null;
  latestSeq: number;
  throughSeq: number;
  overflow: boolean;
  snapshot: LogSnapshot | null;
};
export type ServerLogCursorStatus =
  | "review-window"
  | "reset-for-new-boot"
  | "backfill"
  | "future-cursor"
  | "narrow-window";
export type ServerLogCursorDecision = {
  status: ServerLogCursorStatus;
  reason: string;
};
export type ServerLogCursorReport = {
  decision: ServerLogCursorDecision;
  liveBoot: string;
  latestSeq: number;
  next: ServerLogCursor | null;
  brief: LogBrief | null;
};

export type LogSequenceRange = {
  /** Last sequence before this window (exclusive). */
  after: number;
  /** Last sequence in this window (inclusive). */
  through: number;
};

export type HostLogHandoffRequest = {
  goal: string;
  serverBootId: string;
  earlier: LogSequenceRange;
  later: LogSequenceRange;
  tag?: string;
};

export type HostLogProgress =
  | "recurring-failure"
  | "new-failure"
  | "quiet-after-failure"
  | "needs-attention"
  | "steady"
  | "insufficient-evidence";

export type HostLogHandoffReport = {
  status: HostLogProgress;
  earlier: LogBrief;
  later: LogBrief;
};
