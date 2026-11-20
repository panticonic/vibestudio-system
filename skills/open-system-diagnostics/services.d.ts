import type { DiagnosticArtifact, DiagnosticFinding, DiagnosticSources, DiagnosticWindow } from "./types.js";

declare module "natlang:services" {
  export const diagnosticCatalog: { discover(): Promise<DiagnosticSources> };
  export const diagnosticLog: { read(sourceId: string): Promise<DiagnosticWindow> };
  export const diagnosticHandoff: { stage(finding: DiagnosticFinding): Promise<DiagnosticArtifact> };
}
