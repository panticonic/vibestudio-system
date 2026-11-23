declare module "natlang:services" {
  export const operatorDiscovery: {
    list(): Promise<import("./types.js").OperatorTarget[]>;
    observe(targetId: string): Promise<import("./types.js").OperatorBaseline>;
  };
  export const operatorDeployment: {
    apply(
      observationReceipt: string,
      operation: "start" | "restart",
    ): Promise<import("./types.js").OperatorAttempt>;
    verify(installationReceipt: string): Promise<import("./types.js").OperatorReadback>;
  };
  export const operatorProfile: {
    inspect(observationReceipt: string): Promise<import("./types.js").OperatorProfile>;
    pair(profileReceipt: string): Promise<import("./types.js").OperatorPair>;
    open(pairReceipt: string): Promise<import("./types.js").OperatorRoute>;
    verify(routeReceipt: string): Promise<import("./types.js").OperatorChild>;
  };
}
