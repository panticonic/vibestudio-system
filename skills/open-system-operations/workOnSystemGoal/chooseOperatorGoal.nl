---
description: Identify the owned target and interpret what the user authorized.
args:
  goal: string
  targets: OperatorTarget[]
returns: 'OperatorChoice | null'
---
1. Identify which listed target the user means. Pick only one that fits the user goal. Leave the target undecided if it is unclear which authority applies.
2. Choose inspect for a readiness audit, ensure-ready when the user wants the target made available if needed, and restart for an explicit request to reapply or restart an existing deployment. Choose inspect-profile for a request to examine the CLI profile and pair for an explicit pairing and access request. Choose an action compatible with the target's surface. Preserve request restrictions when choosing a write.
