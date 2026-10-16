---
name: workspace-mobile-client
description: Develop and diagnose the React Native client in the user’s System workspace, including workspace navigation, scoped approvals, the host API it runs on, and mobile equivalents of shared shell behavior.
---

# Workspace Mobile Client

`clients/mobile-browser` is the source of the React Native client (`vibestudio.client` runtime `react-native`, host ABI `rn-host-6`). It lives in the user’s
**System** workspace and is delivered to the device by the host after pairing. It shows
the Personal, System, and any other workspaces the account can access over a
single account connection. Workspaces are isolated from each other; contexts
stay inside their workspace.

## What this client does and doesn't own

- The host runtime owns everything device-level: pairing and re-pairing, the
  device credential and signing identity, the single physical Iroh connection
  (on a fresh per-process endpoint the device key delegates) and its
  reconnection, delivering and verifying this client's build, and push (FCM,
  notifee, lock-screen decisions). This client runs only after the host has
  paired and started it in its own React Native instance; it never runs
  unpaired and holds no credential.
- The client reaches the host through `@vibestudio/rn-client-api` and nothing
  else host-owned. `App.tsx` builds the API once (`connectNativeClientApi`),
  installs it with `installClientApi` from `@workspace/client-kit-native/host`
  and registers the root component `VibestudioClient`. Services and components
  read it with `clientApi()`; tests install a fake from
  `@workspace/client-kit-native/testing` (`createFakeClientHost`, the real API
  over an in-memory host).
- Import rules: the raw device modules (`react-native-keychain`,
  `@react-native-firebase/*`, `@notifee/react-native`,
  `@react-native-async-storage/async-storage`,
  `@react-native-clipboard/clipboard`) and the root of
  `@vibestudio/mobile-iroh` are not available in a client instance and are
  blocked at build time. Only `@vibestudio/mobile-iroh/polyfills` and
  `import type` from `@vibestudio/mobile-iroh` are allowed. `rawModuleImports.test.ts`
  enforces this. Persisted state is `api.state`, the clipboard is
  `api.clipboard`, links open through `api.openExternal`, browser import is
  `api.browserImport`, push is `api.notifications`, and what the host grants is
  `api.capabilities`. Each call fails with the host's refusal when the
  capability is not granted.
- The panel-hosting natives (`VibestudioWorkspaceWebView`, the durable asset
  store and per-workspace cookie clearing in `VibestudioPanelHost`,
  `react-native-tcp-socket`, `react-native-webview`) exist in the instance only
  when `panel-hosting` is granted; they are not device capabilities.
- An account session is `api.session.openAccount()` (hub control plus routed
  workspace sessions); `MobileRpcClient` adapts one `RemoteConnection` to the
  `RpcClient` surface. A panel's own session is `connection.transport.openSession`
  (an auxiliary session on the same physical connection; its token comes from
  `getToken` on each authentication). A session closed with reason
  `trust-revoked` is terminal: the host tears the instance down and the client
  neither retries nor reopens it.
- Intents arrive through `api.intent` (`initial`, `onIntent`); `open-panel`
  carries the raw panel link in `params.panel`. Don't read deep links from
  `Linking` for panel links.

## Workspaces

- `MobileWorkspaceDirectory` keeps one `RemoteAccount` control session
  and opens immutable child sessions on demand. Selecting a workspace changes
  what is shown; it never reloads the client.
- The app ensures the account’s Personal and System workspaces exist with
  `hubControl.ensureUserWorkspaces`. Both are private to that account. Other
  workspaces can have several members.
- Each opened workspace has its own `ShellClient`, Jotai store, panel tree,
  local focus, and pinned panels. Only activated workspaces mount panel
  screens; expanding a tree or reviewing an approval does not load its panels.
- The device surfaces the server calls into (workspace readiness, browser
  privacy presentation, browser import) stay on the System client
  (`exposesDeviceSurfaces`). A target workspace's session hosts that
  workspace's panels and calls its services. Don't expose native browser
  import through target workspace sessions.
- New creates a panel in the focused panel’s workspace; the + on a workspace
  heading creates one in that heading's workspace. About panels load their
  source from their own workspace. Never fetch a missing about page from
  System.
- Quickfire requests, command arguments, file reviews, and async actions keep
  the workspace and panel they started in. Changing focus must not retarget a
  pending operation or move its draft.
- The phone drawer and the permanent tablet drawer show the same stacked
  workspace sections. Keep the existing Command, Quickfire, and Approval
  sheets; don't add another bottom-navigation system.

## Approvals and connections

- `WorkspaceApprovalSurface` is the only visible approval surface. It shows
  the existing approval controllers of opened workspaces; for unopened
  workspaces, whether attention is needed is unknown until the host supplies
  metadata. Background requests add an attention marker without opening a
  modal.
- Show the requesting workspace and the verified website origin. Closing the
  surface leaves the approval pending. A decision made on another device
  removes it through the existing pending-change event.
- Settings is account-level UI bound to System. Capture the workspace being
  managed when Settings opens; later panel focus changes must not change which
  workspace the policy editor edits.
- `WorkspaceConnectionsSection` edits the existing host policy using
  compare-and-swap on `expectedPolicy`. Each rule names a specific peer
  workspace, initiating user, RPC target, method, and purpose (`call` or
  `discover`). Incoming and outgoing rules are independent upper limits;
  allowing one does not grant method or resource access. Incoming calls to
  System are always blocked.
- App-to-app integration uses the existing RPC with an explicit destination
  workspace and the existing target/context semantics. Child sessions opened by
  the UI are for account navigation; untrusted application code cannot reuse
  them as a grant.
- Push payloads carry a host-stamped `{serverId, userId, workspaceId}`. Queued
  decisions and deep links must match that scope before they use a client;
  never take the scope from the focused workspace. Legacy actions without a
  scope are not replayed. Notification IDs and local state are namespaced by
  account and workspace.

## Pairing

- Pairing and re-pairing belong to the host; there is no pairing, paste-link
  or credential screen here. `ConnectScreen` only opens the account and offers
  Retry, which keeps the pairing. "Re-pair" in the UI asks the host to forget
  this device (`api.device.reset()`); the host tears every client down and
  returns to its pairing screen.
- The host cannot read the clipboard for the client, so there is no
  paste-avatar action; the profile editor only clears or undoes an avatar.
- A connected app can create account-level invitations for another device
  through `hubControl.pairDevice`. The receiving device authenticates first and
  then opens that account's Personal workspace by default. Settings → Devices
  shows the complete server-minted HTTPS link, its expiry, copy/share actions,
  and regeneration. `hubControl.awaitPairing({ code })` reports the invite's
  outcome (paired device, expired, or cancelled), the same as on desktop. It
  never reconstructs pairing fields or touches the current device's refresh
  credential.

## Updates

- The server announces a ready build; the host decides what to do. The client
  observes it only through `api.updates`: `clientUpdatePortFromHost`,
  `createHostUpdateModel` and `observeHostUpdates` in
  `@workspace/client-kit-native` feed the `@workspace/client-update-core` model
  from the host's pending offer and `onUpdate`, and `useHostUpdates` presents
  it with `presentClientUpdates`.
- Install is `api.updates.restartAtSafePoint()`; roll back is
  `api.updates.rollback()`. The host reloads only this client's instance. In
  development mode the host reloads without asking; the client must simply
  survive its instance being replaced.
- There is no bundle download, activation or build-key bookkeeping in the
  client. `vibestudio.client.hostAbi` in `package.json` declares the host
  contract the client was written for. The host reports the client
  `unavailable`, naming the expected ABI, when it differs from the one it
  implements.

## Desktop Parity

- `clients/desktop-browser` and this client are clients of the same workspace model. Check
  navigation, approval, identity, and lifecycle behavior in both.
- Use the same identity and state projections as the desktop. Render natively
  and idiomatically, but never add a mobile-only fallback data path.
- Shared chrome (approval sheet, connection bar, update prompt, workspace rows,
  and the design tokens, icons and `MobileUnitIcon` they draw with) lives in
  `@workspace/client-kit-native`, built on the headless cores; this app wires its
  own data into them (`WorkspaceApprovalSurface`, `WorkspaceConnectionBar`,
  `BrowserKitProvider`). Change shared chrome there, not here.
- For unit icons, use `MobileUnitIcon`/`MobilePanelIcon`. Relative manifest
  images resolve through the authenticated local asset facade, browser panels
  use captured favicons, SVG artwork renders through `react-native-svg` (not
  React Native `Image`), and each kind keeps its own fallback icon.
- Add a focused mobile behavioral test when shared shell behavior changes. A
  desktop-only test says nothing about the mobile client.
- The command palette and panel-scoped agent sessions share the model and use
  a native renderer. `src/commands/slate.ts` binds
  `@workspace/quickfire-core`'s slate definitions to mobile implementations,
  `src/components/CommandSheet.tsx` runs the shared omnibox engine and argument
  state machine, and `src/components/QuickfireSheet.tsx` drives the same
  durable conversation as the desktop overlay through
  `@workspace/quickfire-core/session`. Don't add a mobile-only command
  definition or a second ranking path.
- The command sheet's "Recent pages" group and the `AppBar` address field both
  come from `ShellClient.panels.getBrowserAddressOptions`, ranked by
  `@workspace/omnibox-core`. The sheet drops search-engine rows (they are an
  address-bar feature, not a destination) and does not fetch favicons.
  `nav.history` re-scopes the sheet to `@history:` instead of navigating.

## Durable observations

- Treat events that announce durable state as invalidations of an
  authoritative projection, not as a complete state store. Install local event
  handlers before admitting a watch or direct-event source, so no transition
  can land between the initial read and listener registration.
- Prefer a server admission snapshot when the event service provides one. If
  it does not, pair the admitted listener with an authoritative read and a
  synchronous generation counter: discard or repeat any read crossed by an
  event, so a stale in-flight response can never overwrite newer state.
- Use `@vibestudio/shell-core/durableObservation` for event-backed projections
  shared with desktop or terminal clients. Its `ready` receipt owns admission
  and the first authoritative read. Its asynchronous `stop()` owns late
  admission, the in-flight read, and remote leave; cleanup must observe that
  promise rather than treating removal of a local listener as retirement.
- Register recovery handlers with the durable observation's Promise-returning
  invalidation receipt. Recovery completion must await the authoritative
  refresh instead of merely scheduling it, and the handler must be removed as
  part of the observation's local listener lifetime.
- Approval observation is part of workspace readiness. Keep its state explicit
  as `starting`, `ready`, or `failed`; await event admission and the initial
  authoritative queue read before publishing a ready workspace. Register its
  refresh with the recovery coordinator so recovery completion awaits the
  read, and join remote unsubscription before closing the workspace transport.
  A controller whose event admission failed cannot be repaired by a list read:
  retire that exact lifetime, then create and start a new controller. Serialize
  replacement per owner so repeated Retry actions never overlap ownership.
- Panel startup follows this contract explicitly. Admit the complete panel
  projection watch before post-paint reconciliation, then repeat the
  authoritative panel read if a lease, tree, presentation, activation, or
  activation-failure event arrives while that read is in flight. First paint
  may use a restored or freshly loaded tree; it is not the final reconciliation
  boundary.
- Events that represent transient commands rather than durable state may remain
  edge-triggered. They still own event admission and asynchronous retirement;
  use a no-op projection read rather than a second fire-and-forget subscription
  path. Do not manufacture product state for an action that has no
  authoritative current value.

## Verification

- Run the focused checks declared by the client package and the affected
  workspace packages.
- Use `extensions/mobile-debug/SKILL.md` for device or simulator verification.
- Use the repository mobile smoke workflow only when the change crosses the
  host API, pairing, transport, or update boundaries.

## Browser storage isolation

All managed and website WebViews use `VibestudioWorkspaceWebView`, built on
React Native WebView's supported `nativeConfig` extension. Before the view
loads anything, the native manager binds it to a profile keyed by the captured
account/workspace. Android uses `WebViewCompat.setProfile` and requires
`MULTI_PROFILE`; iOS uses `WKWebsiteDataStore.dataStoreForIdentifier`, and the
app's minimum is iOS 17. If the platform lacks support, show an update message;
never fall back to a shared profile or fake isolation with cookie flags or
incognito mode.

The loopback asset façade port is also stored per account/workspace. The native
content-addressed asset store is keyed by server/workspace; reusing an immutable
asset does not give a browser profile or runtime session access to anything.
