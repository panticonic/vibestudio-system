# Remote Clients And Pairing

Remote clients use user/device credentials issued by the hub, plus
short-lived principal grants. Device and user invitations are hub-control
operations made by an authenticated human account.

## Concepts

| Concept           | Purpose                                                                                |
| ----------------- | -------------------------------------------------------------------------------------- |
| Pairing invite    | One-time Iroh bootstrap material: Endpoint ID, ordered relay set, code, expiry         |
| Device credential | Long-lived device id plus refresh token, stored by the client/native host              |
| Shell token       | Remote shell credential presented as `refresh:<deviceId>:<refreshToken>` over the pipe |
| Principal grant   | One-use grant scoped to one client principal, bound to the endpoint and exact build    |
| Connection info   | Iroh reach plus server/workspace identity                                              |

## Desktop Remote Session

Remote startup keeps one hub session and a separate session per workspace:

1. Redeem a user-bound or root-bootstrap invite and store the global device
   credential.
2. Call `hubControl.ensureUserWorkspaces` on the authenticated hub session to
   obtain the user's private Personal/System pair. Load native client source
   from System.
3. Call `hubControl.routeWorkspace` for each workspace the user opens. It
   returns that child workspace's current Iroh reach without creating another
   account identity. Use the hub session for the catalog and account
   operations; bind each child session to one workspace. Changing focus must
   not redirect an in-flight operation or replace the System client
   implementation.

`vibestudio remote pair "https://vibestudio.app/p#<compact-payload>"` (or the
equivalent `vibestudio://connect/<compact-payload>` link) exchanges a pairing
invite over the pipe and stores the device credential.
`vibestudio remote select <name>` switches to another child workspace's reach
and keeps the same credential for later workspace listing and selection.

## Mobile Client

The mobile host stores a device credential and requests a principal grant for a
React Native client with the authenticated RPC `auth.grantClientPrincipal` over
its existing connection. The resulting principal id is device-scoped:

```text
client:<id>:react-native:<device-id>
```

for example `client:browser:react-native:<device-id>`. To run a different
mobile client, launch it by id or source (`clients.launch` with
`{ id }` or `{ source }`); the principal is then scoped to that client's `id`.
The host stores the selected client with the activated bundle, so reconnects
refresh grants for the same client. Do not add an implicit client-source
fallback.

The selected source must be in the authenticated user's System workspace. A
panel, website, or client in another workspace cannot make itself a client the
host runs by declaring the same source name or capabilities.

The client uses the principal grant for RPC and never stores or handles the
refresh token in JS.

## Terminal Client

The terminal runtime is a client module, like the desktop browser: the System
workspace builds it and the terminal host (`vibestudio`) runs it on the device.
It never runs as a server process. Other workspaces may keep terminal client
source for authoring. `clientDefaults.terminal` in `meta/vibestudio.yml` names
the client `vibestudio terminal` opens; the System template declares
`clients/terminal-browser` (`@workspace-clients/terminal-browser`), the reference
terminal client.

`vibestudio terminal` routes to the account's System workspace, runs the
launch gate for the `terminal` runtime (startup approvals are asked in line
mode before the TUI starts), then calls `auth.grantClientPrincipal` over its
own device connection. The grant is one-use and bound to that connection's
transport endpoint and the exact build, so it works locally and over Iroh. It
returns the connection grant, the device-scoped principal id
(`client:browser:terminal:<device-id>`), and the build the principal may run.
The host fetches that build's primary `index.mjs` over the same connection into
its verified cache, checks its integrity, imports it, and calls its exported
`run(host)`. A terminal client should:

- export `run(host)` (contract: `TerminalClientHost`, `terminal-host-1`) and use
  the client-principal `host.rpc` for its own System state, `host.workspaceRpc` for
  the workspace it shows (`host.workspace`, the account's Personal workspace
  unless the person chose another), `host.stdin`/`host.stdout`, and the
  host's connection state; it never handles the device credential
- return an exit (`quit`, `switch-workspace`, or `connection-lost`) instead of
  exiting the process; the CLI restores the terminal
- use its client identity and manifest capabilities for privileged calls
- do workspace work on its child session; account, device, and
  workspace-catalog control belong to a human shell's separate hub session

A new workspace's initial source comes from the selected template's file list;
Personal and System have different sources. Importing or copying source does
not copy approvals or grants. Unit admission and changes to capabilities,
source, dependencies, runtime, or `trust.clients` go through the normal approval path.

## Pairing Invite Creation

Only the hub session held by desktop, mobile, and external CLI shells can
create pairing invites. A workspace client has only its child session and cannot
make hub-control requests on a shell's behalf. `pairDevice` binds an invite to
the authenticated shell's account. `inviteUser` requires an account admin with
explicit workspace-admin authority for every target workspace. Personal and
System have a single owner and cannot have other members.

## URL And Transport Rules

- Remote clients pair through Iroh using an Endpoint ID and an ordered list of
  HTTPS relays. Do not add public-ingress, VPN, or cleartext-host exceptions
  for RPC reachability.
- Pairing QR codes use the HTTPS form `https://vibestudio.app/p#...`; native
  links use `vibestudio://connect/...`. Both carry the same reach v5 payload
  and use the same parser.
- In a pairing invite, `deepLink`, `pairUrl`, `endpointId`, `relays`, and
  `code` are always non-null. Do not add handling for bare codes or missing
  links.
- `vibestudio://connect` is for pairing bootstrap. OAuth callbacks use the
  platform-specific OAuth seam and must not trigger pairing reset.

## Recovery And UX

Remote-client UX should handle:

- revoked device credential
- stale endpoint reach
- expired pairing code or unreachable configured relays
- Endpoint ID mismatch after an explicit server identity rotation
- no active mobile client bootstrap
- no built terminal client (`clientDefaults.terminal` missing or not ready)
- terminal client principal grant refused, or the terminal connection lost

An authenticated transport can remain `connected` while the server replaces
its session generation. Long-lived RPC observers should listen with
`rpc.onRecovery(handler)`: `resubscribe` means the server retained session
state, while `cold-recover` means callers must rebuild observations from an
authoritative snapshot. The RPC client settles its own pending-call and
exposure policy before notifying these observers. Recovery handlers should
start their own abort/join/reopen work without blocking transport recovery.

The recovery surface must stay usable even when no client can load.

## Operational Debugging

When testing pairing or remote-server state without a shell UI:

1. Start the hub with `--ready-file`. On a fresh identity DB, redeem the
   single `rootInvite` with the CLI to become root. Its deep link and
   HTTPS/QR URL are two encodings of the same invite.
2. Select a workspace and inspect and resolve approvals through the
   authenticated workspace services. Do not mint a shell principal from a
   process token.
3. Use `build.listUnits()` to check whether declared units are built. Pass the
   unit name as a release key, `{ kind: "client", releaseId: name }`, to
   `runtime.supervision.describe` or `logs`; each returned row carries the
   `identity` that `health` and `restart` take.
4. From client, panel, worker, or eval contexts, use `serverLog.query/tail/stats`
   (`services.serverLog.*` in eval, or a descriptor from
   `@vibestudio/service-schemas/mainRpc` with `rpc.call("main", ...)` elsewhere)
   or the `about/server-logs` viewer for host server logs such as
   pairing, reconnect, client reconcile, gateway, and shutdown events. See
   `../server-logs/SKILL.md`.
