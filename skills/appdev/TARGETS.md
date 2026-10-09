# App Targets

An app's target determines how it is built, delivered, and activated.

## Electron Target

Manifest:

```json
{
  "vibestudio": {
    "app": {
      "target": "electron",
      "renderer": "index.tsx",
      "capabilities": ["notifications"]
    }
  }
}
```

An Electron app is built as a browser app and loaded into an Electron
`WebContentsView` with the app preload. It is not a panel, although it uses the
same low-level view infrastructure.

Behavior:

- App IPC identity is `callerKind: "app"` and `callerId` is the app package
  name.
- Host capabilities are derived from the approved app manifest.
- Camera, microphone, and location requests need both the matching manifest
  capability and a site-origin permission approval. The capability alone does
  not grant device access.
- Updates to an already-loaded Electron app use `adoptionPolicy: "prompt"`.
  The existing view stays loaded until the user chooses `Load update` from a
  notification or the App updates settings section.
- `panel-hosting` app views are full-window host chrome, not panel content.
  Do not size them to the panel content rectangle.
- Declaring `panel-hosting` grants host-view authority, so use it only for
  shell apps that own panel layout and host chrome.
- Shell app changes can break core UX: panel layout, title bar, overlays,
  pairing links, menus, notifications, and app event subscriptions.

The built-in shell currently declares:

```json
[
  "native-menus",
  "notifications",
  "open-external",
  "window-management",
  "panel-hosting",
  "incoming-pair-links"
]
```

## React Native Target

Manifest:

```json
{
  "vibestudio": {
    "app": {
      "target": "react-native",
      "renderer": "App.tsx",
      "rnComponentName": "Vibestudio",
      "rnHostAbi": "<RN_HOST_ABI>",
      "capabilities": ["notifications", "open-external"]
    }
  }
}
```

`rnHostAbi` must equal the host's `RN_HOST_ABI` (`@vibestudio/shared/buildProvider`);
the build fails with the expected value otherwise.

A React Native app is built through a registered build provider. The server
exposes an app bootstrap to the native host. The native host picks the artifact
for its platform, verifies its integrity, writes it to native storage, and
reloads React Native onto that bundle.

Behavior:

- The shipped native bootstrap must be able to pair a clean install before a
  workspace app bundle exists.
- Native code holds the persistent device credentials.
- The workspace mobile app uses a short-lived principal grant, not the
  long-lived refresh token.
- The bootstrap may contain one or several platform artifacts; the native host
  picks the one for its platform.
- Platform primary artifacts must have `platform: "android"` or `platform:
"ios"` and an integrity string.
- Provider identity is part of the trusted identity. If it is missing, the
  build is rejected.
- Updates are installed through a native prompt. `Install` prepares and
  activates the current trusted bundle; `Roll back` switches the server to the
  previous trusted build, then activates that bundle.

## Terminal Target

Manifest:

```json
{
  "vibestudio": {
    "app": {
      "target": "terminal",
      "entry": "index.ts"
    }
  }
}
```

A terminal app builds to a Node ESM entry artifact that the System workspace
server can launch as a supervised app process. All three targets are hosted
only in the protected System workspace; an app declared in another workspace
keeps its source for authoring but is never offered for native launch.

The server emits `apps:available` with `launchMode: "terminal-process"`.
Disabled or stopped terminal apps report `available`; launched ones report
`running`.

Behavior:

- The runner starts the approved primary `.mjs` artifact with Node.
- The app authenticates over `/rpc` with a one-time app principal grant.
- Runtime identity is `callerKind: "app"` and `callerId` is the app package
  name, for example `@workspace-apps/remote-cli`.
- The runner passes bootstrap env vars:
  `VIBESTUDIO_TERMINAL_APP_ID`, `VIBESTUDIO_TERMINAL_APP_SOURCE`,
  `VIBESTUDIO_TERMINAL_APP_BUILD_KEY`,
  `VIBESTUDIO_TERMINAL_APP_EFFECTIVE_VERSION`,
  `VIBESTUDIO_TERMINAL_APP_GATEWAY_URL`,
  `VIBESTUDIO_TERMINAL_APP_RPC_TOKEN`, and
  `VIBESTUDIO_TERMINAL_APP_CONNECTION_ID`.
- After activation, a terminal build stays `available` until the host target
  is launched or
  `runtime.supervision.activate({ kind: "app", releaseId: appName })` starts
  the process.
- Pushed updates and rollback replace the process if it is running.
- Read stdout/stderr with
  `runtime.supervision.logs({ kind: "app", releaseId: appName })`.

Use terminal apps for trusted CLI clients, remote-server setup helpers, and
pairing/client-management flows that should run with app capabilities instead
of shell authority.

## Target Selection

Use:

- `electron` for trusted desktop client UI.
- `react-native` for mobile client UI delivered to the native host.
- `terminal` for trusted CLI/client processes.

Use panels, not apps, for user-facing workspace UI. Apps carry more trust and
heavier approval than panels.

Host target selection is local state, not workspace configuration. It is
stored in workspace state; do not write it into `meta/vibestudio.yml`. A
workspace may contain several apps for the same target under `apps/*`. Desktop
and mobile pick their client implementation from the acting user's System
workspace, using the approved host-target selection there. Focusing another
workspace neither selects its app as native chrome nor reloads the client.

Selection modes:

- `follow-ref`: the host follows the app's current approved build.
- `pinned-build`: the host stays on a retained build key until the user selects
  `Follow latest` or picks another build.
- `pinned-ref`: the host asks the GAD-backed build system to materialize a
  specific ref, then pins the resulting build key.

Pinning serves both recovery and development. If a newer update is approved
while a target is pinned, the server records the newer build in rollback
history and keeps the pinned build active. Switch the target back to
`follow-ref` to resume normal updates.

Only host principals (`shell`, `server`) can call host-target management RPC.
Panels, workers, extensions, and other apps cannot change which app a native
host runs. They still receive app lifecycle events and should check
`selectedForHost` to decide whether a notification applies to the current
host.

## Lifecycle Status Semantics

All targets use the same workspace-unit statuses; what "running" means
depends on the target:

| Status             | Meaning                                                                  |
| ------------------ | ------------------------------------------------------------------------ |
| `pending-approval` | A declared app build needs trust approval before it can be activated     |
| `building`         | The server is producing or validating the next build                     |
| `available`        | A trusted build is active and launchable, but no process/view is running |
| `running`          | The selected trusted build is currently hosted by its target runtime     |
| `stopped`          | The app process/view is not currently running                            |
| `error`            | Build, validation, activation, or process supervision failed             |

Target-specific notes:

- Electron shell apps usually report `running` because the host view is
  loaded. Electron updates are adopted on prompt, so a loaded view keeps using
  the old trusted build until the user selects `Load`.
- React Native apps report the server's active trusted bundle. Whether a given
  device has fetched and installed it is up to that device's native host.
- Terminal apps report `available` after build activation and `running` only
  while the supervised Node process is alive.

`apps:lifecycle` carries events for all targets:

- `available`: first trusted build became active
- `update-available`: a newer trusted build replaced the active build, or is
  ready for prompt adoption
- `update-error`: the attempted update failed and the previous build remains
  the effective version
- `rolled-back`: the active build was switched to a retained previous build

Clients use `target`, `source`, `appId`, `buildKey`, `canRollback`, and
`selectedForHost` from the payload to decide whether a prompt applies to the
current host.
