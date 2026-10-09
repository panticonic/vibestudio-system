# Mobile App Authoring

Vibestudio mobile has two layers:

1. The shipped native host bootstrap in the application checkout.
2. The trusted workspace React Native app under `apps/mobile`.

The bootstrap lets the native app pair and then fetch, verify, store, and
activate the workspace app bundle. The workspace app holds the user-visible
mobile UX, so it can be updated through workspace app builds.

## Native Host Responsibilities

The native host handles:

- `vibestudio://connect` and `https://vibestudio.app/p#...` clean-install pairing
- Iroh Endpoint secret and shell credential persistence in OS-backed secure storage
- `auth.getMobileAppBootstrap` over the authenticated Iroh RPC session
- streamed bundle writes from JS (`appendBundleChunk` / `finalizeBundleWrite`)
- integrity verification
- writing the bundle to native-owned storage
- React Native reload onto the active bundle

First pairing must not depend on workspace app code: a clean install has no
workspace bundle and no stored Iroh credential yet.

## Workspace Mobile App Responsibilities

The workspace mobile app handles:

- mobile shell UI
- approval sheets
- notifications UI/state
- panel tree/navigation
- credential/OAuth UX that runs after the workspace app is loaded
- RPC transport using a principal grant

It must not hold long-lived refresh tokens. It calls native host wrappers only
for reset/activation; Iroh transport credentials live in
`@vibestudio/mobile-iroh`.

The workspace bundle entry must register the root component name the native
host requests. The current native host requests `Vibestudio`, so the active
workspace bundle must call:

```ts
AppRegistry.registerComponent("Vibestudio", () => App);
```

Do not rely on the shipped bootstrap's registration: after the native host
reloads onto the workspace bundle, the bootstrap code is no longer the active
JS entry.

Register background notification handlers in the bundle entry at module load
time, before React renders. Firebase and Notifee background delivery may run
the bundle headlessly, so handlers registered from a mounted screen or a
foreground login flow can miss approval pushes and actions.

## Pairing Flow

Clean install:

1. Desktop/server creates a pairing invite.
2. User opens a `https://vibestudio.app/p#<compact-payload>` URL or `vibestudio://connect/<compact-payload>` link on the phone.
3. Native bootstrap consumes the initial URL or URL event.
4. Native bootstrap shows a confirmation on its trusted recovery surface,
   with the target server/workspace label from the link.
5. After user confirmation, native bootstrap dials the advertised hub Endpoint
   ID through its ordered relay set and presents the one-time `code`.
6. Native stores its Endpoint secret, the returned device credential, and the
   hub-control reach.
7. JS calls `hubControl.ensureUserWorkspaces`, routes the authenticated user's
   System workspace, and calls `auth.getMobileAppBootstrap` there over Iroh.
8. JS streams the chosen platform artifact to native chunk-by-chunk.
9. Native verifies the decompressed bundle integrity, writes it to disk, and
   reloads into the workspace app.

Already paired:

1. Bootstrap reads the stored Iroh identity and credential from `@vibestudio/mobile-iroh`.
2. Bootstrap reconnects to the hub Endpoint, ensures the user's Personal/System
   pair, and refreshes System's reach for client-source admission.
3. Bootstrap gates approvals, streams any required bundle update, and reloads.
4. The System app keeps the hub-control session plus a separate
   authenticated child session for each opened workspace. Changing workspace
   focus changes presentation and resource selection, not the client bundle.
   Native keeps the device secrets; panels and websites never get the client
   control interface.

## Bootstrap Payload

`auth.getMobileAppBootstrap` returns:

- `appId`
- `buildKey`
- `effectiveVersion`
- `capabilities`
- `rnHostAbi`
- app-level `integrity`
- `artifacts[]`
- build provider identity

Each primary artifact includes:

- `path`
- `role: "primary"`
- `contentType`
- `encoding`
- `platform: "android" | "ios"`
- `integrity`
- `url`

The bootstrap can contain one or several platform artifacts. The JS
bundle-delivery helper picks the current platform's artifact and streams only
that one to native.

## React Native Build Provider

React Native app builds go through the active provider. The provider's
identity is part of the trusted build identity:

- provider name
- provider active EV
- provider active build key
- provider contract version

If provider identity is missing, activation is refused.

## Native ABI

`rnHostAbi` is the contract version between the workspace app bundle and the
shipped native host, defined once as `RN_HOST_ABI` in
`@vibestudio/shared/buildProvider`. The React Native build provider fails a
build whose manifest declares another value and names the expected one; the
native host rejects a bundle built for another ABI and keeps the recovery
surface available. A host release bumps the constant when the native contract
changes; port the app, then declare the new value.

## Common Mobile Failures

- Bootstrap requires credentials before handling a pair link.
- Pair-link handling lives in the workspace app, which cannot load yet.
- Bootstrap exchanges a pair link without confirming the server URL.
- Active workspace bundle does not register the native root component.
- Background notification handlers are registered from foreground UI instead
  of the bundle entry module.
- Provider emits platformless primary artifacts.
- Server rejects bootstrap because only one platform artifact is present.
- Native host requests one platform but server only provides the other.
- App capabilities and native permission declarations drift apart.
- Refresh token leaks into JS instead of staying in native storage.
