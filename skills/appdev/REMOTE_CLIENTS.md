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
| Principal grant   | Short-lived grant scoped to one app/runtime principal                                  |
| Connection info   | Iroh reach plus server/workspace identity                                              |

## Desktop Remote Shell

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

The mobile native host stores a device credential and requests a principal
grant for the React Native app:

```json
{
  "principal": "react-native-app"
}
```

The resulting caller id is device-scoped, for example:

```text
app:apps/mobile:<device-id>
```

To use a different mobile app, pass its source during bundle bootstrap and
principal-grant refresh:

```json
{
  "principal": "react-native-app",
  "source": "apps/field-mobile"
}
```

The caller id is then scoped to that source:

```text
app:apps/field-mobile:<device-id>
```

The native host stores the selected source with the activated bundle, so
reconnects refresh grants for the same app. Do not add an implicit app-source
fallback to clients.

The selected source must be in the authenticated user's System workspace. A
panel, website, or app in another workspace cannot make itself the native
client by declaring the same source name or capabilities.

The workspace app uses the principal grant for RPC and never stores or handles
the refresh token in JS.

## Terminal Client

The terminal target produces a Node ESM entry. The workspace server launches
it as a supervised app process, but only in the System workspace; other
workspaces may keep its source for authoring. A terminal app should:

- connect over `/rpc` with the runner-provided principal grant
- use its app identity and manifest capabilities for privileged calls
- do workspace work on its child session; account, device, and
  workspace-catalog control belong to a human shell's separate hub session

The built-in `@workspace-apps/remote-cli` is the reference terminal app: it
connects as an app principal and lists workspace status. The template declares
it so it is available for debugging, but it does not run until the shell UI or
`runtime.supervision.activate({ kind: "app", releaseId:
"@workspace-apps/remote-cli" })` starts it.

A new workspace's initial source comes from the selected template's file list;
Personal and System have different sources. Importing or copying source does
not copy approvals or grants. Unit admission and changes to capabilities,
source, dependencies, or target go through the normal approval path.

## Pairing Invite Creation

Only the hub session held by desktop, mobile, and external CLI shells can
create pairing invites. A workspace app has only its child session and cannot
make hub-control requests on a shell's behalf. `pairDevice` binds an invite to
the authenticated shell's account. `inviteUser` requires an account admin with
explicit workspace-admin authority for every target workspace. Personal and
System have a single owner and cannot have other members.

## URL And Transport Rules

- Remote clients pair through Iroh using an Endpoint ID and an ordered list of
  HTTPS relays. Do not add public-ingress, VPN, or cleartext-host exceptions
  for RPC reachability.
- Pairing QR codes use the HTTPS form `https://vibestudio.app/p#...`; native
  links use `vibestudio://connect/...`. Both carry the same compact-v4 payload
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
- no active mobile app bootstrap
- terminal app build available but process not started
- terminal app process exited or failed session auth

The recovery surface must stay usable even when the workspace app cannot
load.

## Operational Debugging

When testing pairing or remote-server state without a shell UI:

1. Start the hub with `--ready-file`. On a fresh identity DB, redeem the
   single `rootInvite` with the CLI to become root. Its deep link and
   HTTPS/QR URL are two encodings of the same invite.
2. Select a workspace and inspect and resolve approvals through the
   authenticated workspace services. Do not mint a shell principal from a
   process token.
3. Use `build.listUnits()` to check whether declared units are built. Pass the
   unit name as a release key, `{ kind: "app", releaseId: name }`, to
   `runtime.supervision.describe` or `logs`; each returned row carries the
   `identity` that `health` and `restart` take.
4. From app, panel, worker, or eval contexts, use `serverLog.query/tail/stats`
   (`services.serverLog.*` in eval, or a descriptor from
   `@vibestudio/service-schemas/mainRpc` with `rpc.call("main", ...)` elsewhere)
   or the `about/server-logs` viewer for host server logs such as
   pairing, reconnect, app reconcile, gateway, and shutdown events. See
   `../server-logs/SKILL.md`.
