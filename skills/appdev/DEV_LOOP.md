# App Development Loop

App development uses the workspace-wide semantic VCS. Read
[vibestudio-vcs](../vibestudio-vcs/SKILL.md) before changing source. Each app
edit records a work unit and appends one local application. Commit takes the
complete local application chain. Publication advances protected `main` after
semantic ancestry/integration validation, approval, and a single atomic ref
update. Builds are produced separately from source.

## Standard Loop

1. Write source through the managed edit/write adapter or `vcs.edit` against
   the working head from `vcs.status`. Use `vcs.move`/`vcs.copy` to move or
   copy files.
2. Run focused tests and `build.getBuildReport` for the app at the context ref.
   The report combines bundling, TypeScript, and static authority diagnostics.
   Add missing requests for statically known calls to the app manifest; a
   request is not a grant.
3. Publish with `vcs.publish({ message })`. It commits the complete local
   chain (move unrelated work to a separate context first) and pushes it.
   Publication reruns the build, typecheck, and authority checks on the exact
   candidate before approval. If it refuses, read the structured diagnostics,
   fix, and publish again. A failed check never advances a protected ref.
4. The post-publication build produces the app artifact. If the app's trusted
   identity changed, approve the install/update/source-change prompt.
5. Adopt the new build through the target's update prompt, or keep the loaded
   build until you are ready.

An explicit check returns structured diagnostics but cannot move refs. Use it
as the fast repair loop; the push gate repeats it on the exact candidate.

If `main` has moved, `vcs.publish` returns `IntegrationRequired` with the
`compare` to review and changes nothing. Merge the incoming coordinates in
local steps, test, and publish again. Follow the typed recovery table in the
VCS skill.

In development, app reconciliation prints an app status line with source,
target, active EV, build key, source HEAD, and clean/dirty state. "Dirty" here
means the context's committed event is ahead of `main` (or its working head
carries applications) and the running trusted app build does not include it
yet. It does not mean uncommitted files on disk. Set
`VIBESTUDIO_APP_DEV_STATUS=0` to silence the line, or
`VIBESTUDIO_APP_DEV_STATUS=1` to print it outside `NODE_ENV=development`.

## Approval Behavior

App approvals are unit approvals: they approve the app build and its declared
capabilities, not individual calls.

Approval can be required when:

- a new app is declared
- app source changes
- target changes
- capabilities change
- dependencies or external dependency versions change
- React Native provider identity changes
- source ref changes

While a changed app is in `pending-approval`, the previous active app may stay
in use until the update is approved, depending on the reconcile path.

## Update Errors And Rollback

A rebuild triggered by publication keeps the previous active build until the
new artifact validates and can be activated. If build, target validation, or
activation fails:

- semantic `main` stays at the published event and the previous build stays in
  use
- app status becomes `error`, and `apps:status` reports the build key and
  effective version still in use
- `apps:lifecycle` emits `type: "update-error"` with the failure message, which
  the shell and mobile clients show as notifications/toasts

Fix the failure with a new semantic event. Do not roll back source history to
hide the failed publication.

A successful update records the replaced build in app version history and emits
`apps:lifecycle` with `type: "update-available"`. Clients that already have the
app loaded adopt it explicitly:

- desktop Electron apps keep the current view and show a notification with
  `Load update` and, when available, `Roll back`
- mobile apps show a native prompt with `Install`, `Later`, and, when rollback
  history exists, `Roll back`
- running terminal apps restart automatically; otherwise the new build waits
  until the host target is launched or
  `runtime.supervision.activate({ kind: "app", releaseId: appName })` starts it

Clients can call
`runtime.supervision.versions({ kind: "app", releaseId: appName })` to list the
current and previous builds, and
`runtime.supervision.rollback({ kind: "app", releaseId: appName }, { buildKey? })`
to switch back to a previous trusted build. Without `buildKey`, it rolls back
to the most recent previous version.

The workspace target picker can also pin a host target to a retained build or
to a specific commit/ref. Use this when the latest desktop, mobile, or terminal
app is broken and the host needs a known-good version. A pinned target does not
follow newer commits: newer approved builds go into history and the host target
stays on the pinned build. Choose `Follow latest` in the picker to resume
normal updates.

## Electron App Loop

For Electron apps:

- Declare only supported Electron host capabilities.
- Shell/chrome apps must declare `panel-hosting`.
- Verify panel layout, titlebar/sidebar, overlays, menu actions, notifications,
  pair-link handling, and event subscriptions.
- When changing the shell's pairing or server connection state, test both local
  and remote startup.

Common failures:

- shell app loaded as a regular app view and sized like panel content
- missing `panel-hosting` blocks view service methods
- missing app event subscriber breaks shell event subscriptions
- unsupported capability blocks app loading
- source was changed outside the managed adapter, so no work unit was recorded
  at the working head
- unrelated work was put in the same context when it needed its own commit
- current `main` has coordinates that were never compared and merged
- changes were committed but never published, so `main` and the active build
  did not advance

## React Native App Loop

For mobile apps:

- Keep native host bootstrap and workspace app responsibilities separate.
- Clean-install pairing must work in the shipped bootstrap before the workspace
  app bundle is available.
- The workspace mobile app connects through native-held credentials and
  short-lived principal grants.
- Test platform-specific bundles; dev/provider builds may not include both
  Android and iOS artifacts.
- Validate OS-level permissions and native module availability separately from
  app capabilities.

Smoke path:

1. Start a pairable server.
2. Install or launch a clean mobile host.
3. Open a `https://vibestudio.app/p#...` or `vibestudio://connect/...` link.
4. Verify native bootstrap completes pairing.
5. Verify the host fetches the current platform bundle and reloads into the
   workspace app.
6. Verify the workspace app can refresh a principal grant and connect RPC.

Android emulator smoke:

```bash
node scripts/cli/mobile-smoke.mjs --platform android --avd <name>
```

iOS simulator loop:

```bash
vibestudio mobile dev --platform ios
```

End-to-end iOS smoke is not supported yet: `mobile smoke --platform ios`
refuses to run. iOS shell builds require macOS, Xcode, and signing
configuration. Use `vibestudio mobile doctor` to inspect signing, generated
entitlements, Firebase, and APNs provisioning. The server still builds the iOS
workspace bundle and serves it over the same Iroh connection as Android.

Desktop and Android pairing smokes over Iroh, from the host checkout:

```bash
pnpm test:iroh-desktop-e2e
pnpm test:iroh-mobile-e2e
```

## Terminal App Loop

For terminal apps:

- Expect `apps:available` with `launchMode: "terminal-process"`.
- Start an available terminal app with
  `runtime.supervision.activate({ kind: "app", releaseId: appName })`.
- Status is `available` when the build is trusted but no process runs, and
  `running` once the runner has spawned the process.
- Address the live process by its release key:
  `runtime.supervision.describe({ kind: "app", releaseId: appName })` and
  `runtime.supervision.logs({ kind: "app", releaseId: appName })` read its rows
  and stdout/stderr; `restart(row.identity)` replaces it.
- For host runner/reconcile failures, use `serverLog.query` (eval:
  `services.serverLog.query(...)`; app/panel/worker:
  `rpc.call("main", "serverLog.query", [{ ... }])`) or the `about/server-logs`
  live viewer; see `../server-logs/SKILL.md`.
- Test pushed updates and rollback while the app is running; the runner should
  replace the process with the selected trusted build.

Write terminal app source as a clean Node ESM entry that reads the
runner-provided `VIBESTUDIO_TERMINAL_APP_*` environment, connects with the
provided RPC grant, and handles shutdown messages from the runner.

## Debugging Headless App State

Headless clients authenticate as paired users; no operator token can mint a
synthetic human shell. On first boot, pair the CLI with the root invite, select
a workspace, and use the typed services from that session.

From app, panel, worker, or eval contexts, use `runtime.supervision.*` with the
app's entity or release identity for the app process, and `serverLog.*` for the
host server. In eval, use `services.serverLog.*`; elsewhere use
`rpc.call("main", "serverLog.query", [{ ... }])`. `serverLog.query/tail/stats`
is read-only and supports live following through `server-log:append`. Humans
can open `about/server-logs`.

Full terminal app smoke:

```bash
pnpm test:terminal-app-smoke
```

It builds the app, starts an ephemeral server, launches the built-in remote CLI
terminal app, asserts it reaches `running`, checks that a pairing invite
appears in the logs, and shuts the server down.

## Updating Docs And Skills

When app architecture changes, update:

- this `appdev` skill
- `skills/onboarding/WORKSPACE_STRUCTURE.md`
- `docs/trusted-workspace-units.md`
- `skills/system-testing/SELF_IMPROVEMENT.md` if the change affects agent
  repair loops
