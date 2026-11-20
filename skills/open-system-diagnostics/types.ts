export type DiagnosticSource = {
  id: string;
  label: string;
  component: string;
  description: string;
};
export type DiagnosticSources = { checkpoints: DiagnosticSource[]; mayStage: boolean };
export type DiagnosticRecord = { seq: number; text: string };
export type WindowStatus = "observed" | "other-boot" | "future" | "expired" | "overflow" | "changed";
export type DiagnosticWindow = {
  source: DiagnosticSource;
  status: WindowStatus;
  saved: { boot: string; sequence: number };
  liveBoot: string;
  through: number | null;
  records: DiagnosticRecord[];
};
export type WindowReading = {
  sourceId: string;
  signal: "failed" | "progress" | "complete" | "quiet" | "unclear";
  decisiveSequences: number[];
  explanation: string;
};
export type Inspection = { window: DiagnosticWindow; reading: WindowReading };
export type Disposition = "ongoing" | "recovered" | "attention" | "clear" | "unconfirmed";
export type ExactDiagnosticCitation = { sourceId: string; boot: string; seq: number; text: string };
export type DiagnosticDecision = {
  status: Disposition;
  reason: string;
  evidence: { sourceId: string; seq: number }[];
  stage: boolean;
};
export type DiagnosticFinding = { status: Disposition; reason: string; citations: ExactDiagnosticCitation[] };
export type DiagnosticArtifact = { path: string; sha256: string };
export type DiagnosticReport = {
  finding: DiagnosticFinding;
  coverage: { sourceId: string; status: WindowStatus; liveBoot: string; through: number | null }[];
  artifact: DiagnosticArtifact | null;
};
