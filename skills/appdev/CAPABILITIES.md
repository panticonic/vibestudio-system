# App Capabilities

Capabilities are privileges an app declares in its manifest. The host and
services check them on each call. They are never inferred from the app's
filesystem path.

Example:

```json
{
  "vibestudio": {
    "app": {
      "target": "electron",
      "renderer": "index.tsx",
      "capabilities": ["notifications", "open-external"]
    }
  }
}
```

## Capability Rules

- Request only what the app needs.
- Adding or removing capabilities changes the trusted build identity and can
  require approval.
- Capabilities apply to active, approved app principals.
- Host callers such as server and shell count as trusted host principals only
  at call sites that explicitly allow them.
- Auth and service APIs report a capability denial as `EACCES`.

## Known Capabilities

| Capability            | Meaning                                                                                                                     |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `panel-hosting`       | App can manage host panel layout, visibility, theme CSS, overlays, and shell view controls. Use only for shell/chrome apps. |
| `incoming-pair-links` | Electron app can receive `vibestudio://connect` deep links from the host.                                                   |
| `notifications`       | App can show notifications and use native notification permission where available.                                          |
| `open-external`       | App can request system-browser external opens through host-gated APIs.                                                      |
| `window-management`   | App can use host window, fullscreen, and display-capture operations where implemented.                                      |
| `native-menus`        | App can create or update native menus.                                                                                      |
| `fs-read`             | Electron app can relay read-only filesystem server RPC through the host.                                                    |
| `fs-write`            | Electron app can relay write-capable filesystem server RPC through the host.                                                |
| `camera`              | Electron or React Native app expects camera access. Electron still requires a site-origin approval.                         |
| `microphone`          | Electron app may request microphone access after a site-origin approval.                                                    |
| `location`            | Electron app may request geolocation access after a site-origin approval.                                                   |
| `keychain`            | React Native app expects native secure credential/keychain access.                                                          |
| `clipboard`           | React Native app expects native clipboard access.                                                                           |

The supported set differs per host target. Electron rejects unsupported host
capabilities before loading an app view. For camera, microphone, and location,
the manifest only makes the app eligible; the browser-site approval queue still
decides once/session/always/block for the requesting origin.

## `panel-hosting`

`panel-hosting` is the most sensitive Electron capability: it lets an app act
as shell chrome. A panel-hosting app may:

- show/hide panel and browser views
- update panel layout bounds
- inject host theme CSS
- show native shell overlays
- forward clicks and browser navigation commands
- subscribe to and forward shell-level event streams

Only shell apps should declare it. Other Electron UI should be a panel unless
it needs trusted client authority.

## Filesystem Capabilities

Electron apps relay filesystem calls only with the matching capability:

- read methods require `fs-read`
- write methods require `fs-write`
- mixed operations such as copy require both as appropriate

Do not add `fs-write` to a shell or app for convenience; it widens what
compromised client code can request.

## App Databases

No app capability grants a generic workspace SQL database. Store app data in a
worker Durable Object service:

- The service's `authority.principals` must include the authenticated principal
  families allowed to resolve it.
- Each DO method must declare a matching
  `@rpc({ website, principals, effect, tier, sensitivity })` receiver policy.
- Expose app-specific methods (`listItems`, `saveSettings`, `appendEvent`), not
  raw SQL, to trusted client renderers.

If the DO exposes a shared or sensitive resource to other principals, declare a
capability in the DO's package manifest and bind the `@rpc` method to it. The
host checks it before entering the method. Private app rows need no approval
prompt.

## React Native Capabilities

React Native capabilities declare what the workspace app expects from the
native platform. The native host and OS permission systems still control actual
access. Keep them in sync with the implemented native modules and app-store
permission declarations.
