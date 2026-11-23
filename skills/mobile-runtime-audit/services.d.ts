declare module "natlang:services" {
  export const androidRuntimeAudit: {
    observeTarget(operationId: string): Promise<import("./types.js").AndroidTargetObservation>;
    observeApplication(operationId: string): Promise<import("./types.js").AndroidRuntimeObservation>;
  };
}
