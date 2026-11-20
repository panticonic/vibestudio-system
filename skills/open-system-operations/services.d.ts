import type {
  OperatorAttempt,
  OperatorBaseline,
  OperatorChild,
  OperatorPair,
  OperatorProfile,
  OperatorReadback,
  OperatorRoute,
  OperatorTarget,
} from "./types.js";

declare module "natlang:services" {
  export const operatorDiscovery: {
    list(): Promise<OperatorTarget[]>;
    observe(targetId: string): Promise<OperatorBaseline>;
  };
  export const operatorDeployment: {
    apply(
      observationReceipt: string,
      operation: "start" | "restart",
    ): Promise<OperatorAttempt>;
    verify(installationReceipt: string): Promise<OperatorReadback>;
  };
  export const operatorProfile: {
    inspect(observationReceipt: string): Promise<OperatorProfile>;
    pair(profileReceipt: string): Promise<OperatorPair>;
    open(pairReceipt: string): Promise<OperatorRoute>;
    verify(routeReceipt: string): Promise<OperatorChild>;
  };
}
