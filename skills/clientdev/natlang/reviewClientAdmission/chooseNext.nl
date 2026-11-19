---
description: Choose what needs attention without treating source compatibility as launch approval.
args:
  source: ClientSourceReview
  host: ClientHostReview
returns: ClientDecision
---
1. Return match-runtime for wrong-runtime or resolve-abi for wrong-abi. Return resolve-required-capabilities when either required-capability list is nonempty.
2. Return review-candidate for working-change. Its prior published build cannot validate the candidate contract.
3. For a published contract, return check-declaration if the build catalog lacks the exact client. For approval-required return await-approval. For error return inspect-build. For building or available return await-build. A ready catalog row and compatible host profile yield reviewed-ready. Optional denials are degradations, not blockers.
