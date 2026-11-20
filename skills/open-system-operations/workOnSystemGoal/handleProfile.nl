---
description: Check an owned terminal profile and pair it only for an authorized workspace request.
args:
  choice: OperatorChoice
  baseline: OperatorBaseline
returns: OperatorReport
budget: { maxTurns: 18 }
---
1. If the hub or child is unverified, report unverified, reason baseline-unverified and the baseline receipt.
2. Call operatorProfile.inspect with the ready baseline receipt. For inspect-profile, only report unpaired for an observed unpaired profile and ready for an observed workspace profile. Other profile states are unverified with reason profile-not-admitted. Include the observed identity and both receipts.
3. A pair request without a pair grant is held with reason approval-required. A granted pair request requires an unpaired profile with an available invitation. Otherwise report held with reason profile-not-admitted.
4. Pass the ready baseline and the unpaired profile observation to pairAndOpen. Return its result.
