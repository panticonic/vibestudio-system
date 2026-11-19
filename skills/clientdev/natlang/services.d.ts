import type { ClientAdmissionObservation } from "./types.js";

declare module "natlang:services" {
  export const clientAdmissionRead: {
    observe(operationId: string): Promise<ClientAdmissionObservation>;
  };
}
