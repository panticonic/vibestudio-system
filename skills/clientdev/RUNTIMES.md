# Client Runtimes

A client's runtime determines how it is built, delivered, and activated. Every
runtime shares one pipeline:

1. `clients.launch` resolves the client on the server and returns its verified
   artifact list (or `approval-required`, `preparing`, `unavailable`).
2. The host checks `hostAbi` against the ABI it implements.
3. The host fetches missing artifacts into its verified cache and checks each
   `integrity` value.
4. The host calls `auth.grantClientPrincipal` (one use, bound to the exact
   build and the requesting endpoint).
5. The host instantiates the client with its host API.

Every client artifact carries an integrity value. Hosts run a client only when
they implement exactly the `hostAbi` it declares; otherwise `clients.launch`
reports it `unavailable` and names the ABI.

| Runtime        | Host ABI         | Hosts                | Entry                  |
| -------------- | ---------------- | -------------------- | ---------------------- |
| `web`          | `web-host-1`     | desktop              | renderer page          |
| `react-native` | `rn-host-6`      | android, ios         | root component module  |
| `terminal`     | `terminal-host-1`| terminal             | program module         |

One unit has one runtime. The toolchains (DOM esbuild, Metro, Node esbuild) have
disjoint dependency sets, so a product that ships on several runtimes is
several units sharing a `vibestudio.client.id`.

## Web Runtime

Scaffold: `prepareProjects([{ projectType: "client", name, title, runtime: "web-host-1" }])`
creates `index.html` and `index.ts` (see [AUTHORING.md](AUTHORING.md#scaffold)).

Manifest:

```json
{
  "vibestudio": {
    "client": {
      "id": "browser",
      "runtime": "web",
      "hostAbi": "web-host-1",
      "entry": "index.tsx",
      "title": "Vibestudio",
      "capabilities": {
        "required": ["device-session", "panel-hosting", "approval-surface", "hub-control"],
        "optional": ["native-menus", "notifications", "open-external", "theme", "devtools", "integration.install"]
      },
      "intents": [
        { "name": "open-panel", "kind": "foreground", "title": "Open panel", "params": { "panel": "string" } }
      ]
    }
  }
}
```

A web client is built as a browser bundle and loaded by the desktop host into
its own window from the verified client cache, with the host preload bridge
(`__vibestudioClient`). It is not a panel, although it uses the same low-level
view infrastructure. The desktop host runs one process with many client
windows.

Behavior:

- The client principal is `client:<id>:web:<deviceId>`, device-scoped like the
  other runtimes.
- Host capabilities are the granted set from the approved manifest and
  `trust.clients`; optional capabilities the host denies are reported in
  `deniedOptional`.
- `__vibestudioClient` (`web-host-1`) is the whole host surface. Beyond
  `describe()` (client id, principal, build, granted capabilities), the event
  and info calls, it has:
  - `update.pending()`, `update.onUpdate(handler)` and
    `update.restartAtSafePoint()`: this client's own newest ready build; applying
    it swaps this window's view to that build and touches nothing else;
  - `state.get()` / `state.set(object)`: one bounded JSON object per client per
    device, written atomically by the host;
  - `intents.subscribe(handler)`: foreground intents (held until subscribed);
  - `menu` (`native-menus`), `panelHost` (`panel-hosting`) and
    `development.setMode(clientId, enabled)` (`device-session`);
  - `integration.install({ id })` (`integration.install`): ask the host to add
    a launcher for a client (a `.desktop` file on Linux, a Start-menu shortcut
    on Windows, a launcher app on macOS). The host confirms in its own UI,
    records what it wrote, and removes it when the client is retired.
- Camera, microphone, and location requests need both the matching manifest
  capability and a site-origin permission approval.
- Updates to an already-loaded client are prompted: the window keeps its loaded
  build until the user chooses `Load update` from a notification or the client
  list. A client in development mode adopts rebuilds immediately.
- `panel-hosting` views are full-window host chrome, not panel content. Do not
  size them to the panel content rectangle.
- Browser changes can break core UX: panel layout, title bar, overlays, menus,
  notifications, and event subscriptions.

## React Native Runtime

Scaffold: `runtime: "rn-host-6"` creates `App.tsx` and `tsconfig.json`.

Manifest:

```json
{
  "vibestudio": {
    "client": {
      "id": "browser",
      "runtime": "react-native",
      "hostAbi": "rn-host-6",
      "entry": "App.tsx",
      "title": "Vibestudio",
      "capabilities": {
        "required": ["device-session", "panel-hosting", "approval-surface", "hub-control"],
        "optional": ["notifications", "clipboard", "open-external", "browser-import", "camera"]
      }
    }
  }
}
```

A React Native client is built through a registered build provider (the
`react-native` runtime extension declared under `runtimeExtensions:` in
`meta/vibestudio.yml`); the server will not start the build until that
extension is ready. One source produces one bundle per platform. The Android
and iOS hosts both run it.

Behavior:

- The shipped host must be able to pair a clean install before any client
  bundle exists.
- The host holds the persistent device credentials, the transport, and every
  raw sensitive native module (keychain, Iroh, push tokens). A client reaches
  native features only through the host API, gated by the capabilities it was
  granted.
- The client uses a one-use principal grant, never the long-lived refresh
  token.
- The artifact list may contain one or several platform artifacts; the host
  picks the one for its platform. Platform primary artifacts must have
  `platform: "android"` or `platform: "ios"` and an integrity string.
- Provider identity is part of the trusted identity. If it is missing, the
  build is rejected.
- Each client runs in its own React Native instance. An update prompts, then
  reloads only that client's instance.
- `@vibestudio/rn-client-api` is the complete `rn-host-6` surface: `intent`
  (`initial`, `onIntent`), `state` (`get/set/remove/keys` per client per
  device), `updates` (`pending`, `onUpdate`, `restartAtSafePoint`, `rollback`)
  and the capability-gated native modules. A client imports it and nothing
  host-owned.

## Terminal Runtime

Scaffold: `runtime: "terminal-host-1"` creates `src/index.ts` exporting `run(host)`.

Manifest:

```json
{
  "vibestudio": {
    "client": {
      "id": "browser",
      "runtime": "terminal",
      "hostAbi": "terminal-host-1",
      "entry": "src/index.ts",
      "title": "Vibestudio Terminal",
      "capabilities": {
        "required": ["device-session", "terminal-app-hosting", "approval-surface"],
        "optional": ["clipboard", "notifications", "local-files", "open-external"]
      }
    }
  }
}
```

A terminal client builds to exactly one primary Node ESM (`.mjs`) artifact. The
System workspace server builds it and the terminal host (`vibestudio`) runs it
on the user's device; it never runs as a server process. The host imports it
from the verified cache after checking `terminal-host-1`; the client does not
check the ABI itself.

A terminal client is trusted chrome, not something people run inside it. The
programs people start in the terminal browser are terminal apps (panels hosted
by terminals, at `terminal-apps/<name>`): untrusted Node programs in workspace
PTYs. See the Base `terminal-apps` skill (`skills/terminal-apps/SKILL.md`).

The server announces a new build on `supervision:changed`; the terminal host
decides: it offers a restart at a safe point, otherwise the next launch uses
the new build.

Behavior:

- `vibestudio terminal` opens the default terminal client
  (`clientDefaults.terminal`). `vibestudio open <id> [intent]` opens any
  terminal client. A client may declare `integration.terminal.command` to
  register `vibestudio <command>`, and `vibestudio clients link <id>` writes a
  shim to `~/.local/bin`.
- The principal is `client:<id>:terminal:<deviceId>`, granted over the
  device's own connection (local or Iroh) and bound to the exact build.
- The client module exports `run(host)`. The host contract is
  `TerminalClientHost` (`terminal-host-1`): a client-principal `rpc` client for
  System, the shown `workspace` with `workspaceRpc`, `stdin`/`stdout`,
  connection state, workspace listing, `openExternal`, plus launch `intent`
  params, `files` (local, consent per path), `clipboard`, `notify`,
  client-scoped `state` (`get()` / `set(object)`, one JSON object per client per
  device) and `update` (`pending()`, `onUpdate(listener)`,
  `restartAtSafePoint()`; in development mode the host re-enters the client
  itself, so keep state on the server or in `state`). `host.signal` is the
  invocation's cancellation. `run` resolves with `quit`, `switch-workspace`, or
  `connection-lost`.
- A background intent never loads the client: the host runs
  `clients.invokeIntent`, with piped stdin as the intent's one `text`
  parameter, and prints the handler's text to stdout.

`clients/terminal-browser` is the reference terminal client.

## Choosing A Runtime

Use:

- `web` for trusted desktop client UI.
- `react-native` for mobile client UI run by the Android and iOS hosts.
- `terminal` for trusted terminal clients run by the terminal host.

Use panels, not clients, for user-facing workspace UI. Clients carry more trust
and heavier approval than panels.

## Default Clients

`clientDefaults` in the System `meta/vibestudio.yml` names the client each host
opens when nothing more specific was asked:

```yaml
clientDefaults:
  desktop: clients/desktop-browser
  terminal: clients/terminal-browser
  android: clients/mobile-browser
  ios: clients/mobile-browser
```

`runtimeExtensions` lists the extensions that must be running before clients of
a runtime can build:

```yaml
runtimeExtensions:
  react-native:
    - extensions/react-native
```

Hosts always resolve the client on the server (`clients.launch`); nothing in a
client or host reads this manifest itself. A workspace may contain several
clients for one runtime under `clients/*`. Focusing another workspace neither
selects its client nor reloads the running one.

## Intents

A client declares entry points as data and each host projects them onto its
platform (launcher shortcuts, `.desktop` files, jump lists, App Intents, CLI
subcommands). `open` is implicit for every client.

- `kind: "foreground"`: the host launches or focuses the client and passes
  `{intent, params}` through the host ABI; a running client receives it as an
  event. Optional `accepts` lists MIME patterns for share-in.
- `kind: "background"`: runs **server-side**, never as client code. It names a
  Durable Object-backed workspace service method as `handler` (subject to the
  client principal's authority) that returns a string. The result is
  `{ text }` and nothing else: there is no `result` field and no streaming
  type. The host calls `clients.invokeIntent({ id, intent, params })` and
  renders the text with platform UI (stdout, a notification, a Siri answer).
  See [AUTHORING.md](AUTHORING.md#background-intent-handlers) for the handler.
- `dynamic` names a service method listing small dynamic entries (recent
  conversations) for shortcut menus.
- Deep links use `vibestudio://c/<id>/<intent>?…`; the host resolves `<id>` to
  the variant for its own runtime.

## Lifecycle Status Semantics

All runtimes use the same unit statuses; what "running" means depends on the
host:

| Status             | Meaning                                                                  |
| ------------------ | ------------------------------------------------------------------------ |
| `not-built`        | Declared, but no build exists yet                                        |
| `pending-approval` | A declared client build needs trust approval before it can be activated  |
| `building`         | The server is producing or validating the next build                     |
| `available`        | A trusted build is active and launchable, but no instance is running     |
| `running`          | The selected trusted build is currently hosted by its host               |
| `stopped`          | The client instance is not currently running                             |
| `error`            | Build, validation, activation, or supervision failed                     |

`supervision:changed` carries one event for every supervised unit (clients and
extensions). Its `change` field says what happened:

- `status`: lifecycle or error changed (`status`, `lastError`)
- `adopted`: a build became the active one; the host applies its own adoption
  policy (prompt on desktop and mobile, safe-point restart or next launch on
  terminal, immediate in development mode)
- `update-rejected`: a newer build was refused (build, validation or
  activation failed) and the adopted build keeps running; `lastError` says why
- `rolled-back`: the active build was switched to a retained previous build

Clients use `identity`, `source`, `runtime`, `artifact.buildKey` and
`canRollback` to decide whether a prompt applies to the current host.
