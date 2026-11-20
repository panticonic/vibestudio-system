# Open System operations

System supplies the remote-access, system-investigation, mobile-runtime audit,
local-model and server-log skills. The open operator workflow connects the
remote-access deployment and commissioning procedures to a goal-only entry
point. It reads what the current terminal device can operate and checks
readiness before taking an authorized action.

| Responsibility | Implementation |
| --- | --- |
| Select the target and decide what the user needs | `chooseOperatorGoal` interprets the goal using current terminal target descriptions. |
| Inspect the selected hub and distinguish a healthy deployment, an inactive one and an authorization hold | `handleDeployment` interprets the observed identity and calls `decideLifecycle`. |
| Start or update the selected target and verify the resulting hub and child workspace | `applyAndVerify` uses the current baseline, installer and readiness receipts. |
| Decide whether to reuse an existing hub and pair a fresh terminal profile | `handleProfile` observes the actual profile and hands off to `pairAndOpen` when authorized. |
| Host-side deployment, profile admission and independent identity reads | The existing test terminal owns the disposable package, loopback hub, private profile, deterministic receipt validation and cleanup. |
| Verify the goal outcome independently | The managed oracle requires evidence of the correct live boot, stable workspace identity after update, or a confirmed hold with no unauthorized operation. |

The teacher receives the user goal and sees only models of the available
operations, actual statuses and public identities. Target creation,
credentials, private expected results and verifier checks remain with the
managed harness.
