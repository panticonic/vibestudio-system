declare module "natlang:services" {
  export const buildPerformance: {
    /** Profile the caller's assigned unit in the current workspace context. */
    observe(operationId: string): Promise<import("./types.js").BuildPerformanceObservation>;
  };
}
