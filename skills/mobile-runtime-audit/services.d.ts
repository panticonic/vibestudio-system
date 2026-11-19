declare module "natlang:services" {
  import type { AndroidRuntimeObservation, AndroidTargetObservation } from "./types.js";

  export const androidRuntimeAudit: {
    observeTarget(operationId: string): Promise<AndroidTargetObservation>;
    observeApplication(operationId: string): Promise<AndroidRuntimeObservation>;
  };
}
