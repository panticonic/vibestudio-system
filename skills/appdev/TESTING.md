# App Testing

App changes can affect startup, trust, pairing, and host UX. Run focused tests
for the target you changed, then broader smoke checks if you changed shared
code.

## Focused Local Commands

From the Vibestudio application checkout:

```bash
pnpm type-check
```

Electron app/shell view changes:

```bash
pnpm vitest run \
  src/main/appOrchestrator.test.ts \
  src/main/panelView.app.test.ts \
  src/main/viewManager.test.ts \
  src/main/ipcDispatcher.test.ts \
  src/main/services/viewService.test.ts
```

App host, trusted unit, pairing, and bootstrap changes:

```bash
pnpm vitest run \
  src/server/appHost.test.ts \
  src/server/services/authService.test.ts \
  packages/unit-host/src/index.test.ts
```

Host target selection changes should also test that:

- the selected target persists per workspace and is not written to
  `meta/vibestudio.yml`
- a missing or incompatible selected app reports an invalid selection
- once a desktop target is selected, Electron ignores availability events for
  other apps
- React Native bootstrap and grants use the selected `apps/<name>` source
- pinned builds/commits stay active when newer approved builds arrive
- selecting a terminal app starts/restarts that process and leaves no other
  terminal app running

Build artifact/provider changes:

```bash
pnpm vitest run src/server/buildV2
```

Pairing scripts:

```bash
pnpm vitest run tests/pair-server.test.ts
```

## Electron Shell Smoke Checklist

Verify:

- shell app loads as full-window chrome
- sidebar/titlebar are not hidden by panel-content bounds
- panel switching still shows exactly one panel content view
- overlays hide panel content when active
- theme CSS reaches hosted views
- event subscriptions work after startup and reconnect
- incoming pair links reach the shell app
- unsupported app capabilities fail before view load

## Mobile Smoke Checklist

Verify:

- clean install can consume `vibestudio://connect`
- bootstrap shows the target server URL and requires Pair/Cancel confirmation
- native bootstrap pairs before the workspace app bundle exists
- active workspace bundle registers the native root component name requested by
  Android/iOS
- native host fetches only the current platform artifact
- integrity verification fails closed on bad artifacts
- workspace app connects with a principal grant
- when using a non-default mobile app, pairing and reconnect grant caller ids
  use `app:apps/<name>:<device-id>`
- approval notifications and in-app approval sheet still work
- app remains recoverable when no active mobile bootstrap exists
- desktop and mobile agree on shared shell identities and states: title
  bar/AppBar, panel tree/drawer, approval callers and install parts,
  launcher/about/new flows, browser favicons, and loading/error/empty states

For a user-facing change in either first-party shell, find the matching
feature in the other client and run its smallest behavioral test. If there is
no matching feature, say so in the handoff. A desktop-only screenshot or test
does not show parity.

## Terminal Smoke Checklist

Verify:

- terminal target builds a Node ESM primary artifact
- `apps:available` includes `launchMode: "terminal-process"`
- status is `available` before launch and `running` after the runner starts it
- `runtime.supervision.activate({ kind: "app", releaseId: appName })` starts an
  available process; `restart(identity)` replaces the identified live process
- stdout/stderr are visible through
  `runtime.supervision.logs({ kind: "app", releaseId: appName })`
- rollback switches to a retained terminal build, and the app returns to
  `available` or `running` depending on whether the process is launched

Run the packaged smoke when you change terminal runtime, app host, pairing, or
process supervision:

```bash
pnpm test:terminal-app-smoke
```

## Approval And Trust Checks

When capabilities or dependency identity change, test:

- new declaration requires approval
- denied approval leaves app inactive or at previous active build
- approved update becomes active
- source change approval works for app repos
- capability denial surfaces clearly
- the user's designated System workspace admits its native client app through
  the normal launch review
- new non-System workspaces show their extension and panel/worker reviews, and
  native app source they contain never creates orphan app launch reviews or
  runtime principals there

## Regression Areas

Watch for regressions in:

- shell app identity: app principal vs shell host authority
- layout model: host chrome vs panel content
- event delivery: local IPC subscriber and server replay
- mobile bootstrap: no credentials yet vs already paired
- remote startup: revoked device credential recovery
- platform-specific RN artifacts
