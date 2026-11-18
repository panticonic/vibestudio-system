import type { SystemInteractionAudit } from "../../../types.js";

export default function findWorkspaceReceipt(
  evidence: SystemInteractionAudit,
): string | null {
  return (
    evidence.receipts.find(
      (receipt) => receipt.workspace !== evidence.start.workspace,
    )?.id ?? null
  );
}
