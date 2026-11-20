---
description: Investigate a user's System host incident from authorized retained log checkpoints.
args:
  goal: string
returns: DiagnosticReport
---
1. Call diagnosticCatalog.discover. Treat checkpoint titles, components and descriptions as source metadata. Call chooseCheckpoints with the goal and those checkpoints.
2. Call readWindow with the goal and each selected checkpoint id. Keep the actual window and interpretation from every call.
3. Call reconsider with the goal, the catalog checkpoints and the inspections. If it names an unread checkpoint, read it and call reconsider once more. You may read at most two contingent checkpoints. Keep the original observations even when a newer or narrower one supersedes its conclusion.
4. Call decideOutcome with the goal, the inspections and whether staging is authorized. Call bindReport with its decision and the complete inspections to obtain the exact citations and coverage. A non-observed window has no records to cite.
5. If the decision asks to stage, staging is authorized, and the finding has citations, call stageHandoff with that exact finding and return the actual receipt in artifact. Otherwise return the bound report with artifact null.
