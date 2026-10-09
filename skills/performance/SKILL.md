---
name: performance
description: Measure and optimize panel, app, worker, DO, build, startup, Electron, mobile, or agent performance with native profiling surfaces.
---

# Performance profiling

Measure one user-visible boundary at a time. Say explicitly whether each run is
cold or warm, optimize only measured bottlenecks, and repeat the same experiment
afterward.

## Choose what to measure

| Question                          | Tool                                                |
| --------------------------------- | --------------------------------------------------- |
| Panel action/reload latency       | `profilePanelInteraction`, `profilePanelReload`     |
| Panel CPU or retained objects     | `profilePanel`, `heapSnapshot`                      |
| Build time, cache, or bundle size | `profileBuild`                                      |
| Server/workerd resources          | `profileHost`                                       |
| Startup phases                    | `readStartupProfile`                                |
| Worker or DO isolate CPU          | `profileWorkerd`, `profileDO`                       |
| Electron process resources        | `electronPerformanceSnapshot` via `client_eval`     |
| Android build and readiness       | `mobile-debug.buildAndroid`, `verifyWorkspaceReady` |
| Agent/chat end-to-end latency     | system-test evidence + panel/host profiling         |

These helpers are exported by `@workspace/testkit`; check its exports and docs
for signatures. They return bounded summaries or artifact references, not raw
profiles over RPC.

## Panel and app measurements

Reuse one panel handle and one stable CDP session across runtime incarnations. Perform the
real action and wait for its visible result inside the callback:

```ts
const handle = panelTree.get(panelId);
const session = await handle.cdp.session();
const page = session.page;
try {
  return await page.profile(
    async () => {
      await page.getByRole("button", { name: "Open settings" }).click();
      await page.getByRole("dialog", { name: "Settings" }).waitFor();
    },
    { label: "open settings" },
  );
} finally {
  await session.close();
}
```

To profile a throwaway HTML page, open a browser panel at `about:blank` and
give it the document with `page.setContent(html)`. The example below checks
the final DOM value synchronously and throws on a mismatch instead of waiting
forever for a handler that never ran:

```ts
import { openPanel } from "@workspace/runtime";

await using handle = await openPanel("about:blank"); // archived on block exit
const session = await handle.cdp.session();
try {
  const page = session.page;
  await page.setContent(`<button>Run check</button><output>Ready</output>
<script>document.querySelector("button").onclick = () => {
  document.querySelector("output").textContent = "Done";
};</script>`);
  let finalState;
  const report = await page.profile(
    async () => {
      await page
        .getByRole("button", { name: "Run check", exact: true })
        .click();
      finalState = await page.locator("output").textContent();
      if (finalState !== "Done")
        throw new Error(`Unexpected rendered state: ${finalState}`);
    },
    { label: "one visible click" },
  );
  return { report, finalState };
} finally {
  await session.close();
}
```

Reload workspace panels through the panel handle; use `page.goto` only for
browser pages. Disabling the cache affects only Chromium's HTTP cache, not
application state, service workers, DOs, or server build caches. Reset only the
layer your experiment treats as cold.

To profile a workspace-panel reload, use `profilePanelReload`. It profiles the
host while the renderer is replaced, which a CDP profile cannot do because it is
tied to one page. Afterwards, keep using the panel's session page for
interaction profiling; it rebinds at its next operation:

```ts
import { openPanel, profilePanelReload } from "@workspace/testkit";

const handle = await openPanel("about/new");
try {
  const result = await profilePanelReload(handle, {
    label: "panel reload",
  });
  // The report measures host resources and wall time through boot readiness.
  // Reload preserves the runtime attempt, immutable build, and application storage.
  // Use handle.rebuild() to adopt source changes into a new runtime attempt.
  return result;
} finally {
  await handle.archive().catch(() => undefined);
}
```

Collect JS coverage in a separate run from latency, because coverage changes
profiler overhead. After navigation, a rebuild, or runtime replacement, discard
the old page and get one for the current incarnation.

## Build measurements

Profile the context you are actually working in:

```ts
import { contextId } from "@workspace/runtime";
import { profileBuild } from "@workspace/testkit";

return profileBuild("panels/chat", {
  ref: `ctx:${contextId}`,
  verifyCache: true,
});
```

Call a run cold only when the receipt shows it built during the profile. Count
a repeat as a verified cache hit only when the build keys match. Report initial,
lazy, and total bytes separately, and don't add emitted artifact bytes to sealed
source bytes.

Check bundle attribution before splitting code. Confirm that an import is
unused with coverage or ownership evidence. Request executable module contents
only in a separate, justified source-attribution investigation.

Keep the baseline profile from before your edit, then rerun with the same
options (including `verifyCache: true`) on the edited context. Compare the same
target's initial payload, not artifact or dependency counts. Keep required
runtime peers even if the panel source does not import them directly. Before
reporting an optimization as saved, verify the final version, commit the whole
change, and confirm the status is clean after that commit.

## Host, worker, and startup measurements

Wrap the real operation in `profileHost`; don't build a separate profiling-only
code path. CPU, RSS, heap, and event-loop deltas describe the measured interval;
on their own they don't show retained allocations. Take a heap snapshot only
when you need to attribute objects.

Read the startup profile before raw server logs. Look at supervision health and
logs for one specific runtime. Use durable-work diagnostics for queue, claim,
execution, settlement, and recovery timing.

For isolate CPU, list the available targets and run the real workload inside
`profileWorkerd` or `profileDO`. Regular workers may share a host target; DOs
usually give narrower attribution. Combine CPU profiles with wall time, build
metadata, supervision, and durable-work timing: a CPU profile doesn't show time
spent in storage, RPC, queues, or other processes.

Use raw CDP or V8 inspector sessions only as a last resort. Close them in
`finally`, turn profiling off after the measured operation, and store large
artifacts by reference.

## Electron and mobile

Electron metrics belong to one desktop client. Take
`electronPerformanceSnapshot()` before and after in the same client, and use
panel CDP to attribute cost to panels. Report Electron, server, and workerd
resources separately.

Mobile builds go through the `mobile-debug` extension. Select the attached
device or explicit architectures, then pair the build receipt with
`verifyWorkspaceReady` from the same start time. A running process does not
mean the app is ready. Use native or WebView tooling only for attribution the
extension doesn't provide.

## Agent and chat latency

Measure two things:

1. In the real chat panel, profile from submit to the first visible completed
   response.
2. Run the smallest matching managed system test and inspect its model, tool,
   suspension, delivery, and cleanup evidence.

If the trajectory finishes promptly but the panel is slow, investigate
delivery, projection, or rendering. If model or tool phases dominate and the
browser shows no long tasks, investigate the workflow. Compare recorded
durations or shared durable timestamps; don't subtract readings from unrelated
monotonic clocks.

## Repository-managed instances

If no server is running, create a uniquely named managed instance:

```bash
pnpm system-test --instance <id> doctor
```

Pass that instance ID to every CLI and test call, and stop it during cleanup:

```bash
pnpm system-test --instance <id> stop
```

If you need a direct server, start a named
`pnpm server:live --instance <id> --ephemeral` process yourself, wait until it
is ready, and use only the matching CLI instance. When done, close inspectors
and pages, then terminate the process and wait for it to exit. Never reuse,
restart, or stop someone else's instance.

If isolated bootstrap fails, inspect the supervisor log before reporting a
blocker.

## Cleaning up profiling data

Stopping an instance removes its instance root. It does not remove derived/npm
cache overrides or review worktrees you created; you must track and clean those
up yourself, along with the workloads that use them.

Before writing bulky profiling data, check the backing filesystem (on Linux,
`findmnt -T PATH`, using an existing parent directory if needed). `/tmp`,
`/run/user`, and `/dev/shm` can be RAM-backed, so files left there consume
memory after every process exits. Use a private disk-backed directory such as
`${XDG_CACHE_HOME:-~/.cache}/vibestudio-performance` (check it too). Put review
worktrees and installed toolchains there as well.

Keep evidence you want to retain apart from regenerable scratch data:

- Create new, empty derived and npm caches for each cold experiment. Record
  their paths and which workload uses them.
- In a `finally`-style cleanup step, close inspectors, then stop that
  experiment's workloads and wait for them to exit, then delete its caches and
  temporary checkpoints.
- An immediate warm comparison may reuse the same caches; delete them before
  the next cold sample.
- Remove a review worktree you created once its changes are integrated.
- Never delete an inherited or shared cache, or another operation's worktree.

If stopping a workload or deleting scratch data fails, save bounded diagnostic
evidence to disk and fix the failure before starting another experiment. Before
reporting cleanup complete, check that none of your processes are still running
and none of your scratch paths remain. Keep profiles, logs, and receipts, not
whole dependency trees or build caches. Watch memory and scratch usage between
samples. Never clean up an active workload just because it has run for a long
time.

## Writing fast code from the start

- Report the app as ready before loading optional history, suggestions,
  indexing, or diagnostics.
- Load expensive operation-specific code only in the operation that needs it.
- Keep shared entry points, package barrels, React module evaluation, worker
  constructors, and DO entry modules small and free of side effects.
- Run independent I/O concurrently when semantics allow; deduplicate requests
  in the data layer.
- Bound the size of collections, logs, queues, caches, and diagnostics.
- Verify that lazy boundaries survive the builder and runtime loader; the
  source syntax alone doesn't prove it.
- Keep one implementation. Split it into a small core plus lazily loaded
  features rather than adding a lightweight parallel version.

Before claiming a result from code reading (eager imports, serialized
independent work, repeated builds, polling, unstable React effects, unbounded
data, optional startup work), confirm it with a focused measurement.

## Optimization workflow

1. Define the top-level behavior and when it counts as complete.
2. Capture comparable baselines. Include both cold and warm only when users
   actually hit both.
3. Rank contributors: CPU, serialized dependencies, I/O, bytes, render churn,
   queueing, unnecessary work.
4. Remove or move work in the code that owns it. Prefer batching,
   single-flight, narrow subscriptions, lazy evaluation, and async or coalesced
   persistence where invariants allow.
5. Run focused tests and repeat the same profile. Widen testing only to code
   the change could plausibly affect.

When finished, close every raw page and inspector, archive every panel you
opened, retire every entity you opened, stop every managed test instance, and
terminate every ephemeral server you started. Report before/after values, the
boundary measured, the cold/warm state, and remaining bottlenecks. A faster
internal phase is not a win unless the user-visible completion time improves
without changing behavior.
