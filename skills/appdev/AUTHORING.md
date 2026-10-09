# App Authoring

Trusted workspace apps live under `apps/` and use flat source paths:

| Package name                 | Source path       |
| ---------------------------- | ----------------- |
| `@workspace-apps/shell`      | `apps/shell`      |
| `@workspace-apps/mobile`     | `apps/mobile`     |
| `@workspace-apps/remote-cli` | `apps/remote-cli` |
| `@workspace-apps/foo`        | `apps/foo`        |

Do not add a package scope segment to the filesystem path. The path
`apps/@workspace-apps/foo` is wrong.

## Package Manifest

Each app is a normal package with a `vibestudio.app` manifest in `package.json`:

```json
{
  "name": "@workspace-apps/foo",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "vibestudio": {
    "displayName": "Foo",
    "icon": "✨",
    "app": {
      "target": "electron",
      "renderer": "index.tsx",
      "capabilities": ["notifications"]
    }
  }
}
```

Fields:

- `name`: stable app principal identity. Must use `@workspace-apps/<name>`.
- `vibestudio.displayName`: user-facing name in approvals and unit lists.
- `vibestudio.icon`: one emoji or a safe unit-relative image path such as
  `./assets/icon.svg` (maximum 1 MiB), chosen with the shared
  [icon guide](../workspace-dev/references/icons.md). Shown in unit lists and
  approvals. Use `prepareUnitIcon` when preparing app files or `setUnitIcon`
  for an existing app. Catalog IDs are inputs to those tools; never store them
  in the manifest.
- `vibestudio.app.target`: one of `electron`, `react-native`, or `terminal`.
- Target entry:
  - `electron`: `renderer`
  - `react-native`: `renderer`, plus mobile metadata such as
    `rnComponentName` and `rnHostAbi`
  - `terminal`: `entry`
- `vibestudio.app.capabilities`: explicit host/service privileges.

## Workspace Declaration

Declare apps that are part of the workspace runtime in `meta/vibestudio.yml`:

```yaml
apps:
  - source: apps/shell
    ref: main
```

Declaration fields:

- `source`: repo path such as `apps/shell`, or the app package name when
  supported by the resolver.
- `ref`: git ref to build. Defaults to `main` when omitted.

Changing declared apps, source, ref, dependency EVs, external dependencies,
capabilities, provider identity, or active build identity can re-gate approval.

## Build Identity

App builds are content-addressed and approved as trusted units. The build
identity covers:

- unit kind and package name
- source repo and ref
- effective version of the app
- transitive dependency effective versions
- external dependency versions
- app capabilities
- target/provider metadata where applicable

Adding a capability, changing a dependency, changing the React Native
provider, or pushing new app source can therefore require a new approval before
the app becomes active.

## Runtime Update Protocol

To show update state in its own UI, an app subscribes to `apps:lifecycle`.
The event types are:

- `update-available`: a new trusted build is active on the server and can be
  loaded by clients. Payload includes app id, source, target, build key,
  effective version, previous build metadata, `canRollback`, and an
  `adoptionPolicy`.
- `update-error`: source was published, but its derived build or activation
  failed. The previous active build remains selected. Payload includes the
  error and rollback availability.
- `rolled-back`: the server switched the app back to a previous trusted build.

The adoption policy depends on the target. `prompt` means the client keeps its
loaded build and asks the user when to adopt the new one. `immediate` is used
for first load, user-requested rollback, and terminal process replacement.
Once started, terminal apps are supervised by the server runner.

To list current and previous app builds, call
`runtime.supervision.versions({ kind: "app", releaseId: appName })`. To restore
one, call
`runtime.supervision.rollback({ kind: "app", releaseId: appName }, { buildKey? })`.
Shell can manage every app release; other apps can manage only their own.

Host notifications can include typed app commands:

- `{ type: "app.applyUpdate", appId }`
- `{ type: "runtime.supervision.rollback", release: { kind: "app", releaseId: appId }, buildKey? }`
- `{ type: "runtime.supervision.restart", identity: { kind: "app", entityId } }`

Use these structured commands instead of encoding app ids in action strings.
The desktop shell's connection settings also have an App updates section that
lists pending updates, retained rollback versions, and recent update errors.

## App Data And Worker Services

Apps do not host databases. When an app needs persistent workspace data,
build a worker Durable Object service that owns SQLite through `this.sql`. The
app resolves the service through the runtime and calls narrow RPC methods:

```ts
import { rpc, workers } from "@workspace/runtime";

const store = await workers.resolveService("example.todos.v1", "project-123");
if (store.kind !== "durable-object") throw new Error("Expected DO service");

await rpc.call(store.targetId, "upsertTodo", [
  { title: "Review mobile pairing" },
]);
const todos = await rpc.call(store.targetId, "listTodos", []);
```

Select the provider export in `meta/vibestudio.yml`. Service details belong to
the provider unit's `package.json` under `vibestudio.services`:

```yaml
services:
  - source: workers/todo-store
    name: todo-store
```

```json
{
  "vibestudio": {
    "services": [
      {
        "name": "todo-store",
        "action": "manage todos",
        "presentation": { "domain": "automation", "verb": "manage" },
        "protocols": ["example.todos.v1"],
        "authority": { "principals": ["user", "code"] },
        "durableObject": { "className": "TodoStore" }
      }
    ]
  }
}
```

Keep `title`, `action`, `presentation`, protocols, authority, and transport in
that provider export. The root selection contains only `source` and `name`.

The DO methods must also admit app callers:

```ts
@rpc({
  website: { kind: "closed", reason: "Private todo rows are restricted to the installed app." },
  principals: ["user", "code"],
  effect: { kind: "open" },
  tier: "open",
  sensitivity: "read",
})
listTodos() { ... }
```

Use a singleton object for one workspace-wide database, or pass an `objectKey`
to `workers.resolveService(protocol, objectKey)` for per-project, per-account,
or per-document databases. Do not expose raw SQL to app renderers; expose
app-specific methods and validate inputs in the DO.

For the full schema pattern and tests, read
[`../workspace-dev/WORKERS.md`](../workspace-dev/WORKERS.md#durable-object-backed-app-databases).

## Source And Imports

Use workspace dependencies for shared code:

```json
{
  "dependencies": {
    "@workspace/react": "workspace:*",
    "@vibestudio/rpc": "workspace:*",
    "@vibestudio/shared": "workspace:*"
  }
}
```

Guidelines:

- Keep app-only UI in `apps/<name>`.
- Put reusable cross-target logic in `packages/`.
- Keep native host code outside `workspace/apps/mobile`; the workspace mobile
  app should consume native host APIs through its service wrappers.
- Do not import server/main internals from workspace app code.
- App source is part of the workspace semantic graph. Read
  [vibestudio-vcs](../vibestudio-vcs/SKILL.md), work against a specific working
  head, build or test that state, commit the complete local chain, and publish
  only after ancestry/integration validation and approval.
- Local builds and tests are feedback only. Protected publication reruns the
  build, typecheck, and authority checks on the exact candidate; builds after
  publication are derived from it. Use managed move/copy operations, which
  preserve file identity and provenance; editing files directly on disk does
  not bypass this flow.

## Choosing Apps vs Panels vs Extensions

Use an app when the code is a trusted client runtime:

- the desktop shell UI
- the mobile workspace shell loaded by a native host
- a future terminal client
- a client that owns pairing or principal-grant flows

Use a panel for a workspace surface shown inside the shell. Use an extension
when the code needs trusted Node/server-side access or long-lived service
behavior. Use a worker/DO when an isolate service is enough.

## Panel Links

A panel's loopback HTTP asset URL is not a stable address for it. Use
`buildPanelLink()` for an in-app link, `buildPanelDeepLink()` for an installed
app link, or `buildPanelShareLink()` for an HTTPS App/Universal Link. All three
preserve `ref`, `contextId`, `stateArgs`, `name`, `focus`, and placement
(`current`, `child`, or `root`). Omitting `workspace` stays in the current
workspace; account settings must select their owner with
`workspace: { role: "system" }` or `workspace: { role: "personal" }`.
The installed runtime's `panelLinks.ts` (in the runtime package) defines the
panel link contract. Asset-serving URLs must never implicitly select a
different workspace, context, or revision.

## Hosting panel-contributed commands

Panel commands are a general panel-to-host contract, not specific to the
command palette or chat. Panel authors use `useHostCommands` or the imperative
`panel.registerHostCommands` API documented in
[`../workspace-dev/PANEL_API.md#host-commands`](../workspace-dev/PANEL_API.md#host-commands).
Trusted apps that host panels use the shared registry, which owns the whole
contract: slot attribution (never a panel id from the payload), atomic
replacement of each slot's complete command set, payload validation,
event-only local delivery, and dispatching `{ commandId }` back to the slot.

```ts
import { createHostCommandRegistry } from "@vibestudio/shared/hostCommands";

const hostCommands = createHostCommandRegistry({
  dispatchRun: (panelId, payload) => deliverRunEventToSlot(panelId, payload),
});
```

The host keeps only transport and rendering:

- Hand every envelope addressed to `target: "shell"` to
  `hostCommands.deliverShellEnvelope(panelId, envelope)` before any
  server-backed panel-session path; never forward it to the server. (A host
  whose RPC layer authenticates the caller uses `acceptRpcEvent` instead.)
- Call `hostCommands.release(panelId)` when the slot navigates, closes, or
  loses its runtime, and `release()` on teardown.
- Render `get`/`list` in the platform's style (desktop palette, mobile action
  sheet), re-rendering on `subscribe`, and run through `hostCommands.run`.
  Keep the renderer feature-neutral: no command-specific branching in shell
  code.

Tests should send an unknown future shell event and check that it stays local,
which tests the routing independently of the command event names that exist
today.
