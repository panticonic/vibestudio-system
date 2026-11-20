---
description: Inspect, start or update an authorized Vibestudio hub, or verify a new terminal profile against the owned workspace.
args:
  goal: string
returns: OperatorReport
budget: { maxTurns: 20 }
---
1. Call operatorDiscovery.list. Give the returned targets and user goal to chooseOperatorGoal. If that cannot choose a target, return held with reason unknown-target and no evidence.
2. Observe the chosen target with operatorDiscovery.observe. If the observation is for the terminal profile surface, call handleProfile with the choice and observation. Otherwise call handleDeployment with those inputs.
3. Return the actual result, retaining the exact public identities and evidence receipts.
