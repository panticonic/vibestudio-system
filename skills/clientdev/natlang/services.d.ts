declare module "natlang:services" {
  export const clientAdmissionRead: {
    observe(operationId: string): Promise<import("./types.js").ClientAdmissionObservation>;
  };
}
