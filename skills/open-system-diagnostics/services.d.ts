declare module "natlang:services" {
  export const diagnosticCatalog: { discover(): Promise<import("./types.js").DiagnosticSources> };
  export const diagnosticLog: { read(sourceId: string): Promise<import("./types.js").DiagnosticWindow> };
  export const diagnosticHandoff: { stage(finding: import("./types.js").DiagnosticFinding): Promise<import("./types.js").DiagnosticArtifact> };
}
