---
description: Pair the observed terminal profile, open its route, and independently confirm the same child workspace.
args:
  baseline: OperatorBaseline
  profile: OperatorProfile
returns: OperatorReport
budget: { maxTurns: 18 }
---
1. Pair using operatorProfile.pair and the observed profile receipt. Stop with unverified and profile-not-admitted if pairing failed.
2. On success, call operatorProfile.open with the pair receipt. Return unverified and route-unverified if the route failed.
3. Pass the route receipt to operatorProfile.verify. Only report paired when the child verifies and its workspace ID matches baseline.identity.workspaceId. Return the actual ready identity for paired and a null identity otherwise. Include baseline, profile, pairing, route and verification receipts actually observed in that order. Keep earlier receipts when stopping early.
