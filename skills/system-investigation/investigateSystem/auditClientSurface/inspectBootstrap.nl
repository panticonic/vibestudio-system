---
description: Verify the manifest and selected platform's bootstrap artifact before trusting activation.
args:
  evidence: SystemBootstrapAudit
returns: SystemInvestigationReport
---
Call findPrimary for the exact platform lookup. Then ask decideBootstrap to inspect the manifest against the expectation and the primary artifact. Return its finding. Do not treat a support artifact or a different platform as primaries.
