---
description: Evaluate the panel's initial payload against its assigned budget.
args:
  payload: BuildPayloadObservation
  initialBudgetBytes?: number
returns: PayloadAssessment
---
Compare initialBytes alone with the assigned budget. Greater is over and equal or smaller is within. Use unassigned when there is no budget. If there are initial contributors, call chooseInitialContributor with that exact list. Otherwise use null.
