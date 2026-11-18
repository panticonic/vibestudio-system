declare module "natlang:services" {
  export namespace localModels {
    function listModels(): Promise<
      Array<
        import("./types.js").SystemModelObservation & {
          displayName: string;
          fit: { estTokensPerSec: number | null };
          download: {
            progress: number;
            phase: "active" | "queued" | "paused";
          } | null;
        }
      >
    >;
  }
  export namespace serverLog {
    function query(filter: {
      sinceSeq: number;
      tag: string;
      limit: number;
    }): Promise<{
      serverBootId: string;
      latestSeq: number;
      records: import("./types.js").SystemLogRecord[];
    }>;
  }
}
