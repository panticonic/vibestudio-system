import type { ApprovalDecision } from "@vibestudio/shared/approvals";

export type PendingAction =
  | ApprovalDecision
  | "submit-client-config"
  | "submit-credential-input"
  | "submit-secret-input";

export type ButtonVariant =
  | "primary"
  | "surface"
  | "danger"
  | "dangerPrimary"
  | "outline";
