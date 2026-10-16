# Client Testing

Client changes can affect startup, trust, pairing, and host UX. Run focused tests
for the runtime you changed, then broader smoke checks if you changed shared
code.

## Focused Local Commands

From the Vibestudio application checkout:

```bash
pnpm type-check
```

Desktop host and web client view changes:

```bash
pnpm vitest run \
  src/main/appOrchestrator.test.ts \
  src/main/panelView.app.test.ts \
  src/main/viewManager.test.ts \
  src/main/ipcDispatcher.test.ts \
  src/main/services/viewService.test.ts
```

ClientHost, trusted unit, pairing, and bootstrap changes:

```bash
pnpm vitest run \
  src/server/clients \
  src/server/services/authService.test.ts \
  packages/unit-host/src/index.test.ts
```

Client resolution changes should also test that:

- `clients.launch` resolves every selection form (`default`, `{ id }`,
  `{ source }`) server-side, and a host with a missing or incompatible
  `hostAbi` or capability gets `unavailable` naming it
- the default client per host comes from `clientDefaults` in
  `meta/vibestudio.yml`
- React Native bootstrap and grants use the launched `clients/<name>` source
- `vibestudio terminal` opens the client named by the System workspace's
  `clientDefaults.terminal`
- `(workspace, id, runtime)` duplicates are rejected at reconcile

Build artifact/provider changes:

```bash
pnpm vitest run src/server/buildV2
```

Pairing scripts:

```bash
pnpm vitest run tests/pair-server.test.ts
```

## Desktop Browser Smoke Checklist

Verify:

- the browser client loads as full-window chrome
- sidebar/titlebar are not hidden by panel-content bounds
- panel switching still shows exactly one panel content view
- overlays hide panel content when active
- theme CSS reaches hosted views
- event subscriptions work after startup and reconnect
- incoming pair links reach the host's `pair` intent
- an unsupported required capability reports the client `unavailable` before
  any view loads

## Mobile Smoke Checklist

Verify:

- clean install can consume `vibestudio://connect`
- bootstrap shows the target server URL and requires Pair/Cancel confirmation
- the host pairs before any client bundle exists
- the client bundle registers the native root component name requested by
  Android/iOS
- native host fetches only the current platform artifact
- integrity verification fails closed on bad artifacts
- the client connects with a principal grant
- when launching a non-default mobile client, pairing and reconnect grant
  principal ids use `client:<id>:react-native:<device-id>`
- approval notifications and in-app approval sheet still work
- the host remains recoverable when no active mobile client bootstrap exists
- desktop and mobile agree on shared shell identities and states: title
  bar/AppBar, panel tree/drawer, approval callers and install parts,
  launcher/about/new flows, browser favicons, and loading/error/empty states

For a user-facing change in either first-party shell, find the matching
feature in the other client and run its smallest behavioral test. If there is
no matching feature, say so in the handoff. A desktop-only screenshot or test
does not show parity.

## Terminal Smoke Checklist

Verify:

- the terminal runtime builds exactly one primary Node ESM (`.mjs`) artifact
  with an integrity value
- `supervision:changed` for the client carries `runtime: "terminal"`
- `auth.grantClientPrincipal` from a paired device returns the
  `client:<id>:terminal:<deviceId>` principal and the active build, locally
  and over Iroh; redeeming the grant from another transport endpoint fails
- `vibestudio terminal` asks startup approvals before the TUI starts, loads the
  granted build's `index.mjs` from the verified cache, runs `run(host)`, and
  restores the terminal on every exit
- without a credential, `vibestudio terminal` starts the local server with its
  output in `<stateDir>/logs/server.log`, pairs, and stops and joins that
  server on quit (unless `--keep-server`)
- after an update or rollback, the restart offer (or next launch) runs the
  selected trusted build

Run the packaged smoke when you change the terminal runtime, the terminal launch
path, client principal grants, or pairing:

```bash
pnpm test:terminal-app-smoke
```

## Approval And Trust Checks

When capabilities or dependency identity change, test:

- new declaration requires approval
- denied approval leaves the client inactive or at previous active build
- approved update becomes active
- source change approval works for client repos
- capability denial surfaces clearly
- the user's designated System workspace admits its clients through the normal
  launch review
- a `trust.clients` change (add, remove, or a trusted client gaining a
  device-level capability) produces a `confirm.critical` card naming the
  client and the capabilities gained, and no standing grant satisfies it;
  revoking trust closes the client's device sessions with `trust-revoked`
- new non-System workspaces show their extension and panel/worker reviews, and
  client source they contain never creates orphan client launch reviews or
  runtime principals there

## Regression Areas

Watch for regressions in:

- client identity: client principal vs host authority
- layout model: host chrome vs panel content
- event delivery: local IPC subscriber and server replay
- reconnect recovery while the transport is already reporting `connected`:
  long-lived RPC observers must resubscribe from `rpc.onRecovery`, since a
  status transition alone does not report every completed server generation
- mobile bootstrap: no credentials yet vs already paired
- remote startup: revoked device credential recovery
- platform-specific RN artifacts
