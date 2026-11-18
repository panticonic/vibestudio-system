---
description: Assess the requested local model and distinguish fit, progress, and a current failure.
args:
  model: SystemModelObservation | null
  slug: string
returns: SystemInvestigationReport
---
Return one finding. Cite local:<slug> when the row exists, with no evidence ID for an absent model. For ready or startable, report ready with code model-ready. For downloading or starting, report attention with code model-in-progress. For not-installed, report blocked with code model-does-not-fit if fit is too-big, otherwise model-not-installed. For error, call classifyFailure with the error text or the empty string and prefix the returned category with model-. For absent, report inconclusive with code model-absent.
