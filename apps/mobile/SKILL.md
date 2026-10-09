---
name: workspace-mobile-app
description: Develop and diagnose the React Native client in the user’s System workspace, including workspace navigation, scoped approvals, pairing, and mobile equivalents of shared shell behavior.
---

# Workspace Mobile App

`apps/mobile` is the source of the React Native client. It lives in the user’s
**System** workspace and is streamed to the native host after pairing. It shows
the Personal, System, and any other workspaces the account can access over a
single account connection. Workspaces are isolated from each other; contexts
stay inside their workspace.

## What this app does and doesn't own

- First pairing is handled by the native bootstrap that ships in
  `apps/mobile`.
- This app runs only after the native host has paired, fetched the current
  platform artifact, verified its integrity, and reloaded React Native.
- Long-lived device credentials and the native Endpoint identity live in
  `@vibestudio/mobile-iroh`. This app uses the active Iroh transport and
  short-lived app principal grants.
- Bundle installation and self-update use the shared streamed delivery helper
  in `@vibestudio/mobile-iroh`. Don't add direct HTTP artifact fetches or
  native workspace-selection APIs.

## Workspaces

- `MobileWorkspaceDirectory` keeps one `MobileWorkspaceAccount` control pipe
  and opens immutable child sessions on demand. Selecting a workspace changes
  what is shown; it never changes the saved native bundle source or reloads the
  app.
- The app ensures the account’s Personal and System workspaces exist with
  `hubControl.ensureUserWorkspaces`. Both are private to that account. Other
  workspaces can have several members.
- Each opened workspace has its own `ShellClient`, Jotai store, panel tree,
  local focus, and pinned panels. Only activated workspaces mount panel
  screens; expanding a tree or reviewing an approval does not load its panels.
- App-source capabilities and host launch stay on the System client. A target
  workspace's session hosts that workspace's panels and calls its services.
  Don't expose native browser import through target workspace sessions.
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

## Pairing And Re-Pair

- Accept both `https://vibestudio.app/p#...` and `vibestudio://connect/...`
  links through the shared compact-v4 parser.
- The login/recovery screen should offer paste-link and scanner options that
  call native host capabilities.
- Consumed or stale links must fail visibly and leave the recovery UI usable.
- Re-pairing clears the active OTA bundle and returns to the shipped
  bootstrap; don't try to pair from a stale workspace bundle.
- A connected app can create account-level invitations for another device
  through `hubControl.pairDevice`. The receiving device authenticates first and
  then opens that account's Personal workspace by default. Settings → Devices
  shows the complete server-minted HTTPS link, its expiry, copy/share actions,
  and regeneration. `hubControl.awaitPairing({ code })` reports the invite's
  outcome (paired device, expired, or cancelled), the same as on desktop. It
  never reconstructs pairing fields or touches the current device's refresh
  credential.

## OTA Updates

- `appUpdatePrompt.ts` prompts for trusted mobile app updates.
- Install calls the shared bundle-delivery flow over the app's System
  app-source `MobileRpcClient` transport, then activates the prepared bundle.
- Roll back first changes the trusted server build, then activates the
  selected bundle.
- `rnHostAbi` in `package.json` declares the native host contract the app was
  written for. The build fails, naming the expected value, when it differs from
  the host's `RN_HOST_ABI`.

## Desktop Parity

- `apps/shell` and this app are clients of the same workspace model. Check
  navigation, approval, identity, and lifecycle behavior in both.
- Use the same identity and state projections as the desktop. Render natively
  and idiomatically, but never add a mobile-only fallback data path.
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

## Verification

- Run the focused checks declared by the app package and the affected
  workspace packages.
- Use `extensions/mobile-debug/SKILL.md` for device or simulator verification.
- Use the repository mobile smoke workflow only when the change crosses native
  bootstrap, pairing, transport, or OTA boundaries.

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
