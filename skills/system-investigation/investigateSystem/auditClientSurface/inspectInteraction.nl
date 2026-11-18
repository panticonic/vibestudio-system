---
description: Check that a workspace action, its result and notification stayed with the client captured at action start.
args:
  evidence: SystemInteractionAudit
returns: SystemInvestigationReport
---
Call findWorkspaceReceipt(evidence) to identify the first receipt attributed to a different workspace, if any. If it returns an ID, report blocked with code workspace-attribution and cite that ID. When the expected workspace has more than one direct notification receipt, report attention with code duplicate-notification and cite both notification receipts. If no completion was observed, report inconclusive with code action-unsettled and cite evidence.start.id. Otherwise report ready with code workspace-action-verified and cite the completion. Return one finding.
