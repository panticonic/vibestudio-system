declare module "natlang:services" {
  /** Read-only access to the workspace server's host log ring buffer for the current boot. */
  export namespace serverLog {
    type Records = {
      records: import("./types.js").LogRecord[];
      /** Highest seq captured so far. */
      latestSeq: number;
      workspaceId: string;
      /** Identifies this server boot. Reset any cursor when it changes. */
      serverBootId: string;
      pid: number;
      startedAt: number;
    };
    /** The last N records (default 500) in ascending seq order. */
    function tail(limit?: number): Promise<Records>;
    /** The most recent matches of a filter, in ascending seq order. */
    function query(filter?: {
      sinceSeq?: number;
      untilSeq?: number;
      /** Epoch-ms lower bound (inclusive). */
      since?: number;
      until?: number;
      level?: "verbose" | "info" | "warn" | "error";
      tag?: string;
      contains?: string;
      /** Max records (default 500, max 5000). Keeps the MOST RECENT matches. */
      limit?: number;
    }): Promise<Records>;
    /** Buffer occupancy, the total captured this boot, and counts by level and tag. */
    function stats(): Promise<{
      bufferSize: number;
      totalCaptured: number;
      oldestSeq: number | null;
      latestSeq: number;
      byLevel: { verbose: number; info: number; warn: number; error: number };
      byTag: { tag: string; count: number }[];
    }>;
  }
  export const serverLogCursor: {
    observe(operationId: string): Promise<import("./types.js").ServerLogCursorWindow>;
  };
}
