---
description: Apply one authorized operation, then verify the hub and its child workspace.
args:
  baseline: OperatorBaseline
  operation: '"start" | "restart"'
returns: OperatorReport
budget: { maxTurns: 16 }
---
1. Call operatorDeployment.apply with the observed baseline receipt and selected operation. On baseline-changed or failed, return unverified with reason baseline-changed or installer-failed respectively, a null identity and both actual receipts.
2. For an applied state, pass the installer receipt to operatorDeployment.verify. Only a verified readback permits reporting deployed for start or restarted for restart. Keep its actual identity and all three receipts in order.
3. For an unverified readback return unverified with null identity and all observed receipts. Use reason readiness-unverified for unready, boot-unchanged for unchanged-boot, and identity-changed for identity-changed. Never treat installer completion as workspace readiness.
