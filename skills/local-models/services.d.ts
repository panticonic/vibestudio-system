declare module "natlang:services" {
  /** Read-only discovery of the local models the local-models extension can run. */
  export namespace localModels {
    /** List the local models with their state: startable, ready, downloading, starting, not-installed, or error. */
    function listModels(): Promise<import("./types.js").ModelRow[]>;
  }
}
