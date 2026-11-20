import { diagnosticHandoff } from "natlang:services";
import type { DiagnosticArtifact, DiagnosticFinding } from "../types.js";

export default async function stageHandoff(finding: DiagnosticFinding): Promise<DiagnosticArtifact> {
  return diagnosticHandoff.stage(finding);
}
