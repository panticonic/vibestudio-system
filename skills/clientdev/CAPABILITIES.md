# Client Capabilities

A capability is a host affordance a client declares in its manifest. The host
implements it and enforces it on each call. Capabilities are never inferred
from the client's filesystem path, and they are a different thing from the
`authority.requests` that gate server and workspace-service calls.

```json
{
  "vibestudio": {
    "client": {
      "id": "foo",
      "runtime": "web",
      "hostAbi": "web-host-1",
      "entry": "index.tsx",
      "capabilities": {
        "required": ["device-session"],
        "optional": ["notifications", "open-external"]
      }
    }
  }
}
```

## Capability Rules

- `required`: the client cannot run without it. A host that does not implement
  a required capability, or a trust list that does not grant a required
  device-level one, reports the client `unavailable` and names the missing
  capability. It never offers to restart anything.
- `optional`: the client degrades without it. A host denies an optional
  capability it lacks or that was not granted, and `clients.launch` reports it
  under `deniedOptional`. Check what was granted before using it.
- Names must come from the catalog below, and a capability is valid for a
  runtime only if some host of that runtime implements it. Unknown names and
  unknown manifest fields are rejected.
- Adding or removing a capability changes the trusted build identity and can
  require approval.
- Capabilities apply to the running client principal
  `client:<id>:<runtime>:<deviceId>`, granted one-use and bound to the exact
  build.
- Auth and service APIs report a capability denial as `EACCES`.

## Capability Catalog

"Device-level" capabilities let a client act as this device or draw surfaces an
agent cannot fake. They are granted only to clients listed in `trust.clients`
(see below).

| Capability | Device-level (needs `trust.clients`) | Hosts | Meaning |
| --- | --- | --- | --- |
| `device-session` | yes | desktop, terminal, android, ios | Act as this device in every workspace it is routed to. |
| `panel-hosting` | yes | desktop, android, ios | Host panels and render host chrome. |
| `terminal-app-hosting` | yes | terminal | Start terminal apps and shells in workspaces. |
| `approval-surface` | yes | desktop, terminal, android, ios | Show approvals and submit your decisions on them. |
| `hub-control` | yes | desktop, terminal, android, ios | Manage workspaces, members and devices on this hub. |
| `native-menus` | no | desktop | Contribute entries to the application menu. |
| `notifications` | no | desktop, terminal, android, ios | Show notifications. |
| `notifications.reply` | no | desktop, android, ios | Receive replies typed into notifications. |
| `tray` | no | desktop | Show an icon in the system tray. |
| `badge` | no | desktop | Show a badge count on the application icon. |
| `global-shortcut` | no | desktop | Register a system-wide keyboard shortcut. |
| `local-files` | no | desktop, terminal | Read and write files on this device that you pick. |
| `clipboard` | no | desktop, terminal, android, ios | Write to the clipboard. |
| `dialog` | no | desktop | Open native file and message dialogs. |
| `open-external` | no | desktop, terminal, android, ios | Open links in your default browser. |
| `browser-import` | no | desktop, android, ios | Import bookmarks, history and passwords from other browsers. |
| `theme` | no | desktop | Change the window theme and appearance. |
| `devtools` | no | desktop | Open developer tools for views it hosts. |
| `camera` | no | desktop, android, ios | Use the camera. |
| `microphone` | no | desktop | Use the microphone. |
| `screen-capture` | no | desktop | Capture the screen. |
| `location` | no | desktop | Read this device's location. |
| `integration.install` | no | desktop, terminal, android, ios | Ask to add launchers for clients to this device. |

Camera, microphone, screen capture and location also pass through the OS or a
site-origin approval; declaring the capability only makes the client eligible.
The host's catalog lives in `@vibestudio/workspace-contracts/clients`
(`CLIENT_CAPABILITY_CATALOG`).

## `trust.clients`

The device-level capabilities (`device-session`, `panel-hosting`,
`terminal-app-hosting`, `approval-surface`, `hub-control`) are granted only to
clients listed in the System `meta/vibestudio.yml`:

```yaml
trust:
  clients:
    - clients/desktop-browser
    - clients/terminal-browser
    - clients/mobile-browser
```

A client not listed never receives a device-level capability, even if its own
manifest requires it; it is reported `unavailable`.

Changing who holds a device-level capability is a **trust change**:

- a publication that adds or removes a client in `trust.clients`, or that makes
  a trusted client declare an additional device-level capability, needs one
  fresh `critical` confirmation from the System owner. The card names the
  client and the powers it gains; no standing grant can satisfy it.
- once confirmed, manifest hot reload applies it live. The client's next launch
  returns the new `grantedCapabilities`, and a running instance gets
  `supervision:changed` with its new effective set. No restart.
- later edits that do not widen the client's device-level capabilities do not
  meet this gate again.
- revoking trust closes the client's device sessions with a stated reason
  (`trust-revoked`).
- declare a device-level capability `optional` when the client should keep
  running, without it, after its trust is withdrawn. Declared `required`, it
  makes the client `unavailable` the moment trust is revoked, and the host
  cannot launch it again until trust is restored or the declaration changes.

A client that needs no device-level capability never meets the gate.

## `panel-hosting`

`panel-hosting` is the most sensitive capability: it lets a client act as
browser chrome. A panel-hosting client may:

- show/hide panel and browser views
- update panel layout bounds
- inject host theme CSS
- show native overlays
- forward clicks and browser navigation commands
- subscribe to and forward shell-level event streams

Only browsers should require it. Other UI should be a panel unless it needs
trusted client authority.

## Authority Requests Are Separate

`vibestudio.authority.requests` declares which server capabilities and workspace
services the client calls (for example `approvals.decide` or
`workspace-service:channel`). A request is not a grant. A capability in the
`vibestudio.client` block gates what the host does for the client; an authority
request gates what the server does for it.

The desktop browser's `theme` and `devtools` host capabilities each have their
own authority request, so reviewers see them separately.

## Client Databases

No capability grants a generic workspace SQL database. Store client data in a
worker Durable Object service:

- The service's `authority.principals` must include the authenticated principal
  families allowed to resolve it.
- Each DO method must declare a matching
  `@rpc({ website, principals, effect, tier, sensitivity })` receiver policy.
- Expose client-specific methods (`listItems`, `saveSettings`, `appendEvent`),
  not raw SQL, to trusted client renderers.

If the DO exposes a shared or sensitive resource to other principals, declare a
capability in the DO's package manifest and bind the `@rpc` method to it. The
host checks it before entering the method. Private client rows need no approval
prompt.

## React Native Capabilities

React Native capabilities declare what the client expects from the host. The
host and OS permission systems still control actual access. Keep them in sync
with the host's implemented modules and store permission declarations.
