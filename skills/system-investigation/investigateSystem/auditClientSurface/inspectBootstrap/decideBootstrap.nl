---
description: Judge trust and selection of the observed React Native bootstrap in verification order.
args:
  evidence: SystemBootstrapAudit
  primary: SystemBootstrapAudit["artifacts"]
returns: SystemInvestigationReport
---
Return one finding. First require the exact ABI, build and provider in the manifest. If mismatched, return blocked with code bootstrap-abi, bootstrap-build, or bootstrap-provider respectively, citing the manifest. If no primary exists for the requested platform, return blocked with code missing-platform-primary citing the manifest. If several exist, return blocked with code ambiguous-platform-primary citing their IDs. Require decompressed content integrity for a single primary. An absent verification means inconclusive with code unverified-primary. A digest mismatch means blocked with code bootstrap-integrity. Matching digests mean ready with code bootstrap-verified. Cite the primary ID for these three outcomes.
