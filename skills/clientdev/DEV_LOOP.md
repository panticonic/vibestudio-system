# Client Development Loop

Client development uses the workspace-wide semantic VCS. Read
[vibestudio-vcs](../vibestudio-vcs/SKILL.md) before changing source. Each
client edit records a work unit and appends one local application. Commit takes
the complete local application chain. Publication advances protected `main`
after semantic ancestry/integration validation, approval, and a single atomic
ref update. Builds are produced separately from source.

## Develop And Deploy With No Restart

You can author a client in the System workspace, launch it on an
already-running server and host, iterate on it live, install it into the OS
launcher, and retire it, without restarting the server, the host process, or
any other client.

This works as long as the client stays inside the ABI the host binary fixes:
the runtime and `hostAbi` the host advertises, the host capability catalog it
implements, and (on mobile) the native modules compiled into the host. A client
that needs a new native capability or module needs a host release. That is
reported as `unavailable` with the missing capability or ABI named, never a
silent failure and never an offer to restart.

The chat clients (`clients/chat-terminal`, `chat-desktop`, `chat-mobile`) are
the worked examples: copy their manifest, intent and entry structure.

### The eight steps

1. **Create** `clients/<name>` with `prepareProjects` from
   `@workspace-skills/workspace-dev`, `projectType: "client"` and a `runtime`
   (`web-host-1`, `terminal-host-1` or `rn-host-6`):
   `prepareProjects([{ projectType: "client", name, title, runtime }])`. It
   scaffolds a minimal, buildable client with package name
   `@workspace-clients/<name>` and a `vibestudio.client` block ([AUTHORING.md](AUTHORING.md)):
   `id`, `runtime`, `hostAbi`, `entry`, no capabilities, and one foreground
   `open` intent. Then edit it to what you need. A background intent also needs
   a service handler ([AUTHORING.md](AUTHORING.md#background-intent-handlers)):
   create the handler's worker with `prepareProjects` `projectType: "worker"`,
   then edit its Durable Object to the recipe.
2. **Declare** it: `- source: clients/<name>` under `clients:` in
   `meta/vibestudio.yml` (and the handler's `services:` / `singletonObjects:`
   entries). Add it to `trust.clients` only if it needs a device-level
   capability; that edit is a trust change with one `critical` confirmation,
   see [CAPABILITIES.md](CAPABILITIES.md#trustclients).
3. **Publish** with `vcs.publish({ message })`. Manifest hot reload re-reads
   the manifest, the server reconciles the declarations, re-seeds trust, and
   builds the unit. The `clients:changed` event makes every host refresh its
   client index: the new client appears in `vibestudio clients list`, a
   browser's client list, launcher menus and shortcut entries. No restart.
   The client index and launching belong to device hosts (`clients.list` and
   `clients.launch` refuse an agent session with `EACCES`); an agent confirms
   its work with `verify` and the publication, and the person's device does
   the rest.
4. **Review.** The unit install review (and a trust-change card, if any)
   appears in the running browser's approval surface, or as a question in the
   terminal when `vibestudio open` starts. Answer it. Until then the client is
   `pending-approval` and the previous state keeps running.
5. **Open it in development mode.** Development mode is a host-side,
   per-client, per-device setting, not a manifest field, so a published client
   cannot opt itself into unprompted reloads. Integrity checks, admission and
   review are unchanged.
6. **Edit and publish.** The server announces the new build on
   `supervision:changed`; a client in development mode adopts it at once and
   restarts only itself. Other clients, the host process and the server keep
   running. Without development mode the host offers the update instead (see
   "Update Errors And Rollback").
7. **Install a launcher** so the OS can start the client.
8. **Retire**: remove the client (and its handler service, and any
   `trust.clients` entry) from the manifest and publish. The host removes the
   launchers it wrote and closes the running instances with a stated reason
   (`retired`; `trust-revoked` when only trust was withdrawn). It reconciles on
   `clients:changed`; nothing scans on a timer.

### Per runtime

Steps 1 to 4 and 8 are identical; steps 5 to 7 differ.

**terminal (`terminal-host-1`).**
5. `vibestudio open <id> --develop` loads the module from the verified cache
   (`--develop=false` ends the mode).
6. A rebuild re-enters the client at the next safe point (`host.update`
   `restartAtSafePoint()`; in development mode the host re-enters it). Keep
   state in `host.state` or on the server. Without `--develop` the host only
   offers the build: `host.update.pending()` is a snapshot of the offer at the
   moment it is called, and `host.update.onUpdate(listener)` is how a running
   client learns of a build that arrives later. A client that shows an update
   notice checks `pending()` once at start and subscribes with `onUpdate`; it
   decides when to call `restartAtSafePoint()`, and keeps running (it does not
   quit) until the host re-enters it.
7. `vibestudio clients link <id> [--name <command>]` writes a shim into
   `~/.local/bin` (or a test-owned bin directory); `vibestudio clients unlink`
   removes it. A client that declares `integration.terminal.command` is also
   reachable as `vibestudio <command>`. A background intent needs no module:
   `echo hi | vibestudio open <id> <intent>` prints the handler's text.

**web, desktop host (`web-host-1`).**
5. Use "Develop" in the browser's client list, or `vibestudio open <id>
   --develop` where the CLI is paired with the desktop. The client opens in its
   own window from the verified cache.
6. A rebuild reloads that window only; `__vibestudioClient.update` offers it
   when the mode is off.
7. A browser (or any client with `integration.install`) calls
   `__vibestudioClient.integration.install({ id })`; the host confirms in its
   own UI and writes the `.desktop` file (Linux), Start-menu shortcut (Windows)
   or launcher app (macOS). Retiring removes it.

**react-native, Android and iOS hosts (`rn-host-6`).**
5. "Develop" in the on-device client list creates a new React Native instance
   for the client.
6. A rebuild recreates only that client's instance (`updates.restartAtSafePoint`);
   the host runtime and other clients are not reloaded.
7. The host pins a launcher shortcut (Android) or refreshes App Intents (iOS);
   retiring unpins or refreshes.

### Proof

The system tests `client-dev-loop-terminal` and `client-dev-loop-desktop` run
this exact scenario with an agent that follows this skill, against a host
started before the client exists. They assert that the server boot id, the host
process id and every other client's instance identity are unchanged; that a
client requiring a capability the host does not implement gets `unavailable`
naming it; and, on desktop, that a trust change produces a `confirm.critical`
card, applies live, and revokes with `trust-revoked`. `client-launch-*`,
`client-intent-background` and `client-update-swap` cover launch, background
intents and the update swap on the template chat clients and a hello client.
The Android variant is a `mobile-smoke` extension.

## Standard Loop

1. Write source through the managed edit/write adapter or `vcs.edit` against
   the working head from `vcs.status`. Use `vcs.move`/`vcs.copy` to move or
   copy files.
2. Run focused tests and `build.getBuildReport` for the client at the context
   ref. The report combines bundling, TypeScript, and static authority
   diagnostics. Add missing requests for statically known calls to the client
   manifest; a request is not a grant.
3. Publish with `vcs.publish({ message })`. It commits the complete local
   chain (move unrelated work to a separate context first) and pushes it.
   Publication reruns the build, typecheck, and authority checks on the exact
   candidate before approval. If it refuses, read the structured diagnostics,
   fix, and publish again. A failed check never advances a protected ref.
4. The post-publication build produces the client artifacts. If the client's
   trusted identity changed, approve the install/update/source-change prompt.
5. Adopt the new build through the host's update prompt (or immediately in
   development mode), or keep the loaded build until you are ready.

An explicit check returns structured diagnostics but cannot move refs. Use it
as the fast repair loop; the push gate repeats it on the exact candidate.

If `main` has moved, `vcs.publish` returns `IntegrationRequired` with the
`compare` to review and changes nothing. Merge the incoming coordinates in
local steps, test, and publish again. Follow the typed recovery table in the
VCS skill.

In development, client reconciliation prints a status line with source,
runtime, active EV, build key, source HEAD, and clean/dirty state. "Dirty" here
means the context's committed event is ahead of `main` (or its working head
carries applications) and the running trusted client build does not include it
yet. It does not mean uncommitted files on disk. Set
`VIBESTUDIO_APP_DEV_STATUS=0` to silence the line, or
`VIBESTUDIO_APP_DEV_STATUS=1` to print it outside `NODE_ENV=development`.

## Approval Behavior

Client approvals are unit approvals: they approve the client build and its
declared capabilities, not individual calls.

Approval can be required when:

- a new client is declared
- client source changes
- runtime or `hostAbi` changes
- capabilities change
- `trust.clients` membership changes (a `critical` trust change)
- dependencies or external dependency versions change
- React Native provider identity changes
- source ref changes

While a changed client is in `pending-approval`, the previous active client may
stay in use until the update is approved, depending on the reconcile path.

## Update Errors And Rollback

A rebuild triggered by publication keeps the previous active build until the
new artifact validates and can be activated. If build, contract validation, or
activation fails:

- semantic `main` stays at the published event and the previous build stays in
  use
- the client keeps status `running` with the error recorded as `lastError`
  ("update not adopted"); a working build is never demoted to `error`
- `supervision:changed` reports `change: "update-rejected"` with the failure
  message, which browsers show as notifications/toasts

A push that fails the protected-main build gate never reaches this state: the
gate builds each affected client and enforces its artifact contract (every
artifact has integrity, exactly one primary per platform, runtime-specific
shape such as a terminal client's single `.mjs` entry), so a bad artifact
rejects the push with the client, runtime and defect named. Only
activation-time failures that need a running host (for example a review the
user has not accepted) land here.

Fix the failure with a new semantic event. Do not roll back source history to
hide the failed publication.

A successful update records the replaced build in the unit's version history and
emits `supervision:changed` with `change: "adopted"`. Hosts that already have
the client loaded adopt it by their own policy:

- desktop shows a notification with `Load update` and, when available,
  `Roll back`
- mobile shows a prompt with `Install`, `Later`, and, when rollback history
  exists, `Roll back`; only that client's React Native instance reloads
- the terminal host offers a restart at a safe point, otherwise the next launch
  uses the new build

Clients can call
`runtime.supervision.versions({ kind: "client", releaseId: clientName })` to
list the current and previous builds, and
`runtime.supervision.rollback({ kind: "client", releaseId: clientName }, { buildKey? })`
to switch back to a previous trusted build. Without `buildKey`, it rolls back
to the most recent previous version.

## Web Client Loop

For web clients:

- Declare only capabilities in the catalog for the desktop host, and mark
  `required` only what the client cannot run without.
- Browsers require `panel-hosting` (and so must be in `trust.clients`).
- Verify panel layout, titlebar/sidebar, overlays, menu actions, notifications,
  and event subscriptions.
- When changing connection state handling, test both local and remote startup.

Common failures:

- browser loaded as a regular view and sized like panel content
- missing `panel-hosting` blocks view service methods
- unsupported or untrusted required capability makes the client `unavailable`
- source was changed outside the managed adapter, so no work unit was recorded
  at the working head
- unrelated work was put in the same context when it needed its own commit
- current `main` has coordinates that were never compared and merged
- changes were committed but never published, so `main` and the active build
  did not advance

## React Native Client Loop

For mobile clients:

- Keep host and client responsibilities separate: the host owns transport,
  credentials and raw native modules; the client owns UI.
- Clean-install pairing must work in the shipped host before any client bundle
  is available.
- Test platform-specific bundles; dev/provider builds may not include both
  Android and iOS artifacts.
- Validate OS-level permissions and native module availability separately from
  client capabilities.

Smoke path:

1. Start a pairable server.
2. Install or launch a clean mobile host.
3. Open a `https://vibestudio.app/p#...` or `vibestudio://connect/...` link.
4. Verify the host completes pairing.
5. Verify the host fetches the current platform bundle and starts the client's
   React Native instance.
6. Verify the client connects with its principal grant.

Android emulator smoke:

```bash
node scripts/cli/mobile-smoke.mjs --platform android --avd <name>
```

iOS simulator loop:

```bash
vibestudio mobile dev --platform ios
```

End-to-end iOS smoke is not supported yet: `mobile smoke --platform ios`
refuses to run. iOS host builds require macOS, Xcode, and signing
configuration. Use `vibestudio mobile doctor` to inspect signing, generated
entitlements, Firebase, and APNs provisioning. The server still builds the iOS
workspace bundle and serves it over the same Iroh connection as Android.

Desktop and Android pairing smokes over Iroh, from the host checkout:

```bash
pnpm test:iroh-desktop-e2e
pnpm test:iroh-mobile-e2e
```

## Terminal Client Loop

For terminal clients:

- The server only builds terminal clients; it never runs them.
- Run the client with `vibestudio terminal` (default client) or
  `vibestudio open <id>` (from the host checkout, `pnpm dev:terminal` for a
  fresh instance, `pnpm cli --instance ID terminal` for a running one, or
  `pnpm start:terminal` for your profile). The host runs the launch gate,
  obtains the device's client principal through `auth.grantClientPrincipal`,
  loads the build's primary `index.mjs` from the verified cache, and calls its
  exported `run(host)` in the CLI process.
- Server output for a server the command started is in
  `<stateDir>/logs/server.log` (`<instanceRoot>/logs/server.log` for
  `pnpm dev:terminal`). For host build, launch-gate, or grant failures, use
  `serverLog.query` (eval: `services.serverLog.query(...)`; client/panel/worker:
  pass `mainRpcMethods["serverLog.query"]` from
  `@vibestudio/service-schemas/mainRpc`) or the `about/server-logs` live
  viewer; see `../server-logs/SKILL.md`.
- To test an update or rollback, publish or roll back, then accept the restart
  offer in a running terminal (or relaunch) and confirm the selected trusted
  build loads.

Write terminal client source as a clean Node ESM module that exports
`run(host: TerminalClientHost)`, uses `host.rpc` (already authenticated as the
client principal) and `host.stdin`/`host.stdout`, and resolves with its exit
instead of calling `process.exit`. The terminal is in line mode when `run`
starts: a client that reacts to single key presses ("press q") calls
`host.stdin.setRawMode(true)` when `host.stdin.isTTY`; the host restores the
terminal when `run` settles.

## Debugging Headless Client State

Headless hosts authenticate as paired users; no operator token can mint a
synthetic human shell. On first boot, pair the CLI with the root invite, select
a workspace, and use the typed services from that session.

From client, panel, worker, or eval contexts, use `runtime.supervision.*` with
the client's entity or release identity for the client's build and activation
state, and `serverLog.*` for the host server. In eval, use `services.serverLog.*`;
elsewhere use `rpc.call("main", mainRpcMethods["serverLog.query"], [{ ... }])`.
`serverLog.query/tail/stats` is read-only and supports live following through
`server-log:append`. Humans can open `about/server-logs`.

Full terminal client smoke:

```bash
pnpm test:terminal-app-smoke
```

Run it when you change the terminal runtime, the terminal launch path, client
principal grants, or pairing.

## Updating Docs And Skills

When client architecture changes, update:

- this `clientdev` skill
- `skills/onboarding/WORKSPACE_STRUCTURE.md`
- `docs/trusted-workspace-units.md`
- `skills/system-testing/SELF_IMPROVEMENT.md` if the change affects agent
  repair loops
