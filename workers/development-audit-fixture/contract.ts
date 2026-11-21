import type { DevelopmentRun, DevelopmentRunEvent, DevelopmentSession } from "@vibestudio/service-schemas/development";

export type NativeAuditSeed = {
  scope: string;
  sessions: DevelopmentSession[];
  entries: { run: DevelopmentRun; journal: Omit<DevelopmentRunEvent, "sequence">[] }[];
};
export type NativeAuditAddress = { scope: string; run: string };
export type NativeAuditKeep = NativeAuditAddress & { snapshot: string; updatedAt: number };
export interface DevelopmentAuditReceiver {
  seed(input: NativeAuditSeed): Promise<void>;
  read(input: NativeAuditAddress): Promise<{ run: DevelopmentRun; session: DevelopmentSession; planMatches: boolean } | null>;
  events(input: NativeAuditAddress & { after: number }): Promise<{ events: DevelopmentRunEvent[]; nextAfter: number | null }>;
  keep(input: NativeAuditKeep): Promise<{ run: DevelopmentRun; event: DevelopmentRunEvent }>;
  proof(input: { scope: string }): Promise<{ runs: DevelopmentRun[]; sessions: DevelopmentSession[]; journals: DevelopmentRunEvent[][]; intents: { runId: string; operation: string; key: string }[] }>;
}
