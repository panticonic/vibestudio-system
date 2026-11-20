# Decomposition: briefing the server host log

Natlang-native method: policy is natural language, mechanism is crisp. Every part of the old procedure in `SKILL.md`
(tail, query, stats, then summarize with `serverBootId` and `latestSeq`) is placed below.

The function is `briefServerLog`, in `briefServerLog.nl`: `briefServerLog({ since?, level? }): LogBrief`.

| Part | Decision | Why |
|---|---|---|
| Read a bounded window (`tail`, or `query` with `since`/`level`, plus `stats`) | crisp helper `briefServerLog/gather.ts` | The outside world. The bound (300 lines) is the service's own "keep queries bounded" rule, not a deadline. |
| Collapse repeated lines (a boot prints `[x] Starting` 86 times) | crisp helper `briefServerLog/condense.ts` | Exact counting and grouping. Numbers, identifiers, quoted text and bracketed names are blurred when comparing messages; the group keeps the exact count and first/last `seq`. It also means each distinct message is judged once, not each line. |
| Judge what a group of lines means: routine, notable or failure | own function `classifyHostLogGroup.nl`, `readout: decision` | This is the policy of the skill ("distinguish a concrete incident from normal activity"). The result is a literal union, so it is one scoring pass, and it can be scored against labels. The level is only a hint: a boot prints `warn` lines that are expected, and the sandbox runtime prints an `error`-level experimental-feature notice. |
| One sentence for the user | crisp, in `briefServerLog/assemble.ts` (a line of counts) | Measured and removed: written by the executor, the headline was the one step that generated text, and on LFM3-1.7B it exhausted its turn budget (6 turns of 1024 tokens, no result) on a case whose decisions all scored. A line of counts carries the same information exactly; the agent writes the prose. |
| Status (`normal`, `attention`, `incident`) | crisp, in `briefServerLog/assemble.ts` | A consequence of the class decisions (any failure, else any notable). Deciding it again in language would be a second, weaker policy. |
| Cite `serverBootId`, `latestSeq`, the window and each finding's `seq` range | crisp, in `briefServerLog/assemble.ts` | The old skill warned that a full tail "drops the identity fields from your own answer". Identity and sequence numbers are copied from the service result by code, never retyped by a model. Every `firstSeq`/`lastSeq` comes from a real line. |
| The order read, condense, judge each, assemble | one eval in `briefServerLog.nl` | A workflow can call this brief directly and the classifier calls stay visible in its call tree. The existing `collect` helper supports direct inspection from the skill. |
| Live following (`server-log:append`), offline JSONL logs, the viewer panel | stays in `SKILL.md` | Subscriptions and teardown are not a one-shot brief. |
| `runtime.supervision.logs(identity)` for a panel, app, extension, worker or DO | stays in `SKILL.md` | A different service. |

## Effects

None. The program uses `serverLog.tail`, `query` and `stats` only. It performs and proposes no effects.

## Services

`serverLog` (`tail`, `query`, `stats`), imported from `natlang:services` in `briefServerLog/gather.ts` only. The model never
sees the service, so it cannot read the log by itself; it sees one group at a time.

## Suite

`suite.ts` and `cases.jsonl`: 15 cases (6 train, 4 validation, 5 test). Windows are real lines from three server logs
captured on this machine (`server-log.jsonl` of two workspaces and one managed instance). The real windows are
benign boots, so incidents come from injecting lines modelled on real host messages (`log.error`/`log.warn` calls in
`src/server`) into a real window; each case's `source` says which. The service fake in `suite.ts` implements the real
`tail`/`query`/`stats` filters over the recorded window.

Scorer: per case, quality is `(exact + 0.5 * wrongClass) / (expected non-routine groups + false alarms)`, and 1 for a
window with nothing to flag. Gates per case: `identity` (the brief carries the recorded boot and latest seq),
`cited` (every finding's `firstSeq`/`lastSeq` is a line that was read), `status` (equals the expected status).

Port gate (the skill is ported only if the executor meets it): validation and test mean quality at least 0.8, `identity`
and `cited` pass on every case, and no more than one case has the wrong `status`.

## Measurement

Executor: LFM3-1.7B Q8_0 on natlang's llama.cpp fork (b12069), CPU, decision readouts scored (`sessionDriver`), run through
`pnpm natlang:eval` unless noted. Gates: validation and test mean quality at least 0.8, `identity` and `cited` on every
case, at most one wrong `status`. `identity` and `cited` passed on every case of every run below: the identity, the
window and every cited `seq` come from code.

| Instruction | Split | Result |
|---|---|---|
| first (routine/notable/failure definitions, the level "only a hint") | validation (4) | 0.50: every incident found, but the sandbox runtime's `Removing unpermitted intrinsics` warnings (probability 0.51 routine, 0.47 notable) flagged as notable in 3 of 4 cases |
| | test (5) | 0.63 (earlier in-process run of the same cases): the same false alarms, one `status` wrong (a slow Durable Object start and a failed worker preparation read as `attention`, not `incident`) |
| sharper routine definition ("a warn or error level never makes a normal line notable") | validation (4) | 0.50 (`pnpm natlang:eval`): no false alarm, but the `state=slow` lines and a `DeprecationWarning` read as routine |
| final: the sandbox start-up notices are "always routine"; notable names what the message says ("state=slow", "has been active for 10s", exceeded a threshold, retried, a Node.js process warning) | validation (4) | **1.00**, 4 of 4, no false alarm and nothing missed |
| | test (5), run once after the tuning | **0.77** (`pnpm natlang:eval`): two cases wrong, a failed worker preparation read as `notable` (status `attention`, not `incident`) and a `Duplicate route registration` warning read as routine (status `normal`, not `attention`); the other three exact, `identity` and `cited` on all five. **Gate not met** (mean 0.8, at most one wrong status) |

The final wording was written against the validation misses, so its validation score is a development score. One of
its groups is still marginal: the `DeprecationWarning` group scores 0.61 routine / 0.39 notable when classified alone,
and passed in the full run.

Outcome: **the gates are not met, so the skill stays agent-executed.** `SKILL.md` leads with the bounded inspection the agent
performs itself and offers the brief as a measured aid whose findings the agent checks against the raw lines. The suite,
the cases and the records stay; the case set seeds adaptation or tuning, and a larger executor would be measured by
changing the profile.

Cost: a scored decision is about 25 s cold on this CPU (the ~3.5k-token opening is prefilled for each request), so a
brief of 23-38 groups takes 7-20 minutes (mean 19.5 minutes a case on a loaded machine). That is the figure that decides
how the skill uses the brief: filter first (`level: "warn"` leaves a handful of groups), or use it for a standing report
rather than an interactive question.

Reference model (the agent's own): not measured; no agent-class model is available in the harness. The window labels were
written by the author from the host's own log messages; every incident is an injected line (see Suite).

## Saved cursor review

The shared workflow combines the exact boot and sequence evidence with a
bounded, fixed-upper-sequence query. The binding checks the server boot and
retained interval, and detects a query with more matches than the authorized
window. Nested Natlang stages decide whether to reset, backfill, narrow or
review the window. The existing log classifier and exact group assembler
summarize a resumable window. The proposed next cursor names the last
sequence covered by the read.

## Incident handoff across two windows

| Part | Decision | Why |
|---|---|---|
| Verify sequence bounds, order and boot identity | crisp companions of `reviewHostLogHandoff` | These are exact preconditions for comparisons. The bounded reader rejects a truncated or evicted window. |
| Read and brief each window | call `briefServerLog` twice | Both windows use the same independent classification and citation machinery as a one-window brief. |
| Compare what failed and decide what to hand off | nested `interpretLogProgress` decision | Distinguishing recurrence from a different failure requires understanding the messages. A quiet window supplies limited evidence. |
| Preserve both windows in the report | crisp assembly | The handoff retains the actual outputs of both calls for follow-up and verification. |
