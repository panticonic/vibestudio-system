declare module "natlang:services" {
  export namespace localModels {
    function listModels(): Promise<
      import("./types.js").SystemModelObservation[]
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
