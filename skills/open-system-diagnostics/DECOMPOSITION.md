# Open System diagnostics

The caller supplies the user's goal and the authorized workspace capabilities.
A saved checkpoint can describe a past incident, a subsequent observation, or a
cursor whose live boot relationship is unknown. The harness keeps oracle
criteria and raw source coordinates private. It exposes the titles and
ownership information available to the operator.

| Stage | Form | Responsibility |
| --- | --- | --- |
| Discover | Scoped service | List owned checkpoint handles and titles. Keep private markers and assigned coordinates in the binding. |
| Choose | Natlang lambda | Select the first observations relevant to the operation and time span the user names. |
| Read | Scoped service | Read the current boot and retention floor, then the exact retained segment. Keep track of boot, sequence, overflow and workspace mismatches. |
| Interpret | Natlang lambda | Distinguish recorded failure, progress, explicit completion and missing evidence. Separate operation duration from evidence about CPU, memory and completion. |
| Replan | Natlang lambda | Select one follow-up observation when a copied cursor, narrower interval or additional trace changes which evidence applies. |
| Decide | Natlang lambda | Reconcile the findings in time order. Bind exact citations to the conclusion and take the user's requested scope into account. |
| Handoff | Scoped service | Write and reread an owned scratch note only when authorized, with exact citations and no change to the server. |
| Verify | Harness TypeScript | Repeat the native retained reads, resolve expected source coordinates from the captured boot, compare the report and read the scratch artifact independently. |

## Existing mechanisms

- `skills/server-logs/SKILL.md` defines bounded log inspection, boot continuity
  and the distinction between the host log and a runtime's own native logs.
- `skills/server-log-cursor-bindings/index.ts` seals one caller-resolved boot,
  tag, interval and maximum. Reuse it after Natlang discovers the checkpoint.
  This preserves native boot, retention and overflow behavior.
- `skills/server-logs/reviewLogCursor.nl` and `reviewHostLogHandoff.nl` operate
  on a caller-selected window. Their inputs assume the selection has already
  happened. Open diagnostics applies their decision boundaries after it
  discovers the live sources. It also supports a contingent second selection.
- `skills/performance/SKILL.md` describes measurement identity and causality.
  These cases interpret observed operation timings and host events. Native
  profiling of a build or a process has its own binding and is outside these
  read-only incident goals.
- `system-testing/skills/system-testing/log-audit-worlds.ts`,
  `log-handoff-worlds.ts`, and `log-cursor-worlds.ts` pin the baseline paths.
  The new runner reuses its actual Host log seed capture and existing
  `server-logs.read` authority. The record text is authored for these worlds,
  and the reads, retention metadata, and evidence sequence numbers are live.
- The authorized scratch handoff uses the same exact persistence boundary as
  `open-goal-recovery-managed.ts`. It does not move a user's saved cursor,
  restart a runtime or act outside the present workspace.
