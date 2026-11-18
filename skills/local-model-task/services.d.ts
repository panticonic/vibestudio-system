declare module "natlang:services" {
  export namespace localModelTaskInventory {
    function inspect(
      ref: string,
    ): Promise<import("./types.js").LocalTaskInventoryRow | null>;
  }
  export namespace localModelTaskInstall {
    function installOnce(
      ref: string,
    ): Promise<import("./types.js").LocalTaskReceipt>;
  }
}
