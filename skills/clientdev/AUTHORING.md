# Client Authoring

Trusted workspace clients live under `clients/` and use flat source paths:

| Package name                          | Source path                |
| ------------------------------------- | -------------------------- |
| `@workspace-clients/desktop-browser`  | `clients/desktop-browser`  |
| `@workspace-clients/mobile-browser`   | `clients/mobile-browser`   |
| `@workspace-clients/terminal-browser` | `clients/terminal-browser` |
| `@workspace-clients/foo`              | `clients/foo`              |

Do not add a package scope segment to the filesystem path. The path
`clients/@workspace-clients/foo` is wrong.

## Scaffold

Create a client with `prepareProjects` from `@workspace-skills/workspace-dev`
(see [workspace-dev](../workspace-dev/PROJECTS.md)); there is no `createProject`
function:

```ts
import { prepareProjects } from "@workspace-skills/workspace-dev";
scope.prepared = await prepareProjects([
  { projectType: "client", name: "foo", title: "Foo", runtime: "web-host-1" },
]);
```

`runtime` is the host ABI: `web-host-1`, `terminal-host-1` or `rn-host-6`; it
fixes the client's runtime and entry. The scaffold is `clients/foo` with
package `@workspace-clients/foo`, client `id` equal to the name, no
capabilities, one foreground `open` intent, and an authority manifest that is
empty except for an `rn-host-6` client: the React Native host gives every
client a workspace context boundary, so its scaffold requests the critical
`context.boundary` and its review shows that.
Preparation does not declare the client: add it under `clients:` (see
[Workspace Declaration](#workspace-declaration)). To add a background intent,
create its handler worker with `prepareProjects` `projectType: "worker"` and
follow [Background Intent Handlers](#background-intent-handlers).

## Package Manifest

Each client is a normal package with a `vibestudio.client` manifest block in
`package.json`:

```json
{
  "name": "@workspace-clients/foo",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "vibestudio": {
    "displayName": "Foo",
    "icon": "✨",
    "client": {
      "id": "foo",
      "runtime": "web",
      "hostAbi": "web-host-1",
      "entry": "index.tsx",
      "title": "Foo",
      "capabilities": {
        "required": ["device-session"],
        "optional": ["notifications"]
      },
      "intents": [{ "name": "open-thing", "kind": "foreground", "params": { "thing": "string" } }]
    }
  }
}
```

Unknown fields in the block are rejected. Fields:

- `name`: stable client identity. Must use `@workspace-clients/<name>`.
- `vibestudio.displayName`: user-facing name in approvals and unit lists.
- `vibestudio.icon`: one emoji or a safe unit-relative image path such as
  `./assets/icon.svg` (maximum 1 MiB), chosen with the shared
  [icon guide](../workspace-dev/references/icons.md). Shown in unit lists and
  approvals. Use `prepareUnitIcon` when preparing client files or `setUnitIcon`
  for an existing client. Catalog IDs are inputs to those tools; never store
  them in the manifest.
- `vibestudio.client.id`: product identity shared by the runtime variants of
  one client (`^[a-z][a-z0-9-]{0,62}$`). `(workspace, id, runtime)` is unique.
- `vibestudio.client.runtime`: one of `web`, `react-native`, or `terminal`.
- `vibestudio.client.hostAbi`: the host ABI the client targets: `web-host-1`,
  `rn-host-6`, or `terminal-host-1`. The host checks it before executing
  anything.
- `vibestudio.client.entry`: web, the renderer entry; React Native, the root
  component module; terminal, the program module.
- `vibestudio.client.title`: display title.
- `vibestudio.client.capabilities`: `required` and `optional` lists from the
  [capability catalog](CAPABILITIES.md).
- `vibestudio.client.intents`: entry points hosts project onto the OS (see
  [RUNTIMES.md](RUNTIMES.md#intents)).
- `vibestudio.client.integration`: per-host hints (`desktop` window size,
  `terminal.command` to register `vibestudio <command>`).
- `vibestudio.authority`: the server capabilities and workspace services the
  client calls; unchanged from other units.

## Workspace Declaration

Declare clients that are part of the workspace runtime in the System
`meta/vibestudio.yml`:

```yaml
clients:
  - source: clients/desktop-browser
    ref: main
clientDefaults:
  desktop: clients/desktop-browser
trust:
  clients:
    - clients/desktop-browser
```

Declaration fields:

- `source`: repo path such as `clients/desktop-browser`, or the client package
  name when supported by the resolver.
- `ref`: git ref to build. Defaults to `main` when omitted.
- `clientDefaults.<host>` (`desktop`, `terminal`, `android`, `ios`): the client
  that host opens by default.
- `trust.clients`: clients allowed device-level capabilities. Changing it is a
  trust change that needs one `critical` confirmation
  ([CAPABILITIES.md](CAPABILITIES.md#trustclients)).

Changing declared clients, source, ref, dependency EVs, external dependencies,
capabilities, provider identity, or active build identity can re-gate approval.

## Build Identity

Client builds are content-addressed and approved as trusted units. The build
identity covers:

- unit kind and package name
- source repo and ref
- effective version of the client
- transitive dependency effective versions
- external dependency versions
- client capabilities, runtime and host ABI
- provider metadata where applicable

Adding a capability, changing a dependency, changing the React Native
provider, or pushing new client source can therefore require a new approval
before the client becomes active.

## Runtime Update Protocol

To show update state in its own UI, a client subscribes to `supervision:changed`
(events for clients and extensions share it; filter on `identity.kind`). The
`change` values are:

- `adopted`: a new trusted build is active on the server and can be loaded by
  hosts. Payload includes the identity, source, `runtime`, build key and
  effective version, previous build metadata, and `canRollback`.
- `update-rejected`: source was published, but its derived build or activation
  failed. The previous active build remains selected and the unit keeps
  running; `lastError` carries the reason.
- `rolled-back`: the server switched the client back to a previous trusted build.
- `status`: any other lifecycle or error change.

The server announces; the host decides. Desktop and mobile prompt: the loaded
client keeps its build and asks the user when to adopt the new one (desktop
swaps that window's view, mobile reloads only that client's React Native
instance). The terminal host offers a restart at a safe point, otherwise the
next launch uses the new build. A client in development mode adopts rebuilds
immediately.

To list current and previous client builds, call
`runtime.supervision.versions({ kind: "client", releaseId: clientName })`. To
restore one, call
`runtime.supervision.rollback({ kind: "client", releaseId: clientName }, { buildKey? })`.
Browsers can manage every client release; other clients can manage only their
own.

Host notifications can include typed client commands:

- `{ type: "client.applyUpdate", clientId }`
- `{ type: "runtime.supervision.rollback", release: { kind: "client", releaseId: clientId }, buildKey? }`
- `{ type: "runtime.supervision.restart", identity: { kind: "client", entityId } }`

Use these structured commands instead of encoding client ids in action strings.
The desktop browser's connection settings also have a Workspace apps section
that lists pending updates, retained rollback versions, and recent update
errors.

## Background Intent Handlers

A background intent (`"kind": "background"`) runs on the server. Its
`handler` is `<protocol>#<method>`: a method of a **Durable Object-backed
workspace service**. A handler is the one place a client needs a worker, so
here is the complete recipe (worked example: `clients/chat-terminal`, whose
`ask` is `vibestudio.quickfire.v1#ask` in the Base `workers/quickfire-service`).

1. **The service.** A worker `workers/hello-echo` with a Durable Object class.
   Scaffold it with the `durable-service` template, then turn it into this
   service: replace `index.ts` with the class below, delete `contract.ts` and
   the `exports` entry for it in `package.json` (the scaffold's `listRecords`
   and `upsertRecord` are a record store you do not want). Preparation needs an
   explicit empty authority manifest, a reason, and a receiver policy for each
   of those two scaffold methods (the `@rpc` policy below will do):

   ```ts
   import { prepareProjects } from "@workspace-skills/workspace-dev";
   const policy = { website: { kind: "closed", reason: "Client background intents are invoked by the server for a paired device." },
                    principals: ["host"], effect: { kind: "open" }, tier: "open", sensitivity: "write" };
   scope.worker = await prepareProjects([{
     projectType: "worker", name: "hello-echo", title: "Hello Echo", template: "durable-service",
     authority: { requests: [], provides: [] },
     authorityReason: "Answers the client's echo intent from the text it is given; no other authority.",
     methods: { listRecords: policy, upsertRecord: policy },
   }]);
   ```

   The scaffold's class is named after the project (`HelloEcho`) and
   `package.json` already declares it under `vibestudio.durable.classes`.
   The echo method receives `{ params, principalId }` (the intent's declared
   parameters and the calling client principal) and returns a **string**. It
   must admit the `host` principal and nothing the client cannot reach:

   ```ts
   import { DurableObjectBase, rpc } from "@workspace/runtime/worker/kernel";

   export class HelloEcho extends DurableObjectBase {
     static override schemaVersion = 1;

     protected override createTables(): void {} // stateless: no tables

     @rpc({
       website: { kind: "closed", reason: "Client background intents are invoked by the server for a paired device." },
       principals: ["host"],
       effect: { kind: "open" },
       tier: "open",
       sensitivity: "write",
     })
     async echo(input: { params: { text: string }; principalId: string }): Promise<string> {
       return `echo: ${input.params.text}`;
     }
   }
   ```

2. **The service declaration** in the worker's `package.json`
   (`vibestudio.kind: "worker"`, `vibestudio.durable.classes`) with a
   `vibestudio.services` entry whose `protocols` contains the handler's
   protocol (`"vibestudio.hello.v1"`), `authority.principals` including
   `host`, and `durableObject.className`. Add `services` to the `vibestudio`
   object the scaffold already wrote (a second `"vibestudio"` key silently
   replaces the first):

   ```json
   "services": [{
     "name": "hello",
     "action": "echo client text",
     "presentation": { "domain": "automation", "verb": "act" },
     "protocols": ["vibestudio.hello.v1"],
     "authority": { "principals": ["host"] },
     "durableObject": { "className": "HelloEcho" }
   }]
   ```

3. **The selection and singleton** in the System `meta/vibestudio.yml`:

   ```yaml
   services:
     - name: hello
       source: workers/hello-echo
   singletonObjects:
     - className: HelloEcho
       key: workspace-hello
       source: workers/hello-echo
   ```

4. **The client's request.** The client declares the intent and asks for the
   service, so the review shows it:

   ```json
   "intents": [{ "name": "echo", "kind": "background", "title": "Echo",
                 "params": { "text": "text" }, "handler": "vibestudio.hello.v1#echo" }],
   ```

   ```json
   "authority": {
     "serviceRequests": [{ "protocol": "vibestudio.hello.v1", "availability": "required" }],
     "requests": [{ "capability": "workspace-service:hello",
                    "resource": { "kind": "exact", "key": "do:workers/hello-echo:HelloEcho:workspace-hello" },
                    "tier": "gated", "evidence": "exact" }]
   }
   ```

The host calls `clients.invokeIntent`; the server resolves the service as the
client principal and dispatches to the method. The result on the wire is
`{ text }` only. A declared parameter of type `text` receives free text (words
after the intent, piped stdin); an undeclared parameter, an undeclared intent
and a foreground intent are rejected.

## Client Data And Worker Services

Clients do not host databases. When a client needs persistent workspace data,
build a worker Durable Object service that owns SQLite through `this.sql`. The
client resolves the service through the runtime and calls narrow RPC methods:

```ts
import { rpc, workers } from "@workspace/runtime";
import { todoStoreRpcMethods } from "@workspace-workers/todo-store/contract";

const store = await workers.resolveService("example.todos.v1", "project-123");
if (store.kind !== "durable-object") throw new Error("Expected DO service");

await rpc.call(store.targetId, todoStoreRpcMethods.upsertTodo, [
  { title: "Review mobile pairing" },
]);
const todos = await rpc.call(store.targetId, todoStoreRpcMethods.listTodos, []);
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

The DO methods must also admit client callers:

```ts
@rpc({
  website: { kind: "closed", reason: "Private todo rows are restricted to the installed client." },
  principals: ["user", "code"],
  effect: { kind: "open" },
  tier: "open",
  sensitivity: "read",
})
listTodos() { ... }
```

Use a singleton object for one workspace-wide database, or pass an `objectKey`
to `workers.resolveService(protocol, objectKey)` for per-project, per-account,
or per-document databases. Do not expose raw SQL to client renderers; expose
client-specific methods and validate inputs in the DO.

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

- Keep client-only UI in `clients/<name>`.
- Put reusable cross-runtime logic in `packages/`.
- Keep native host code outside `clients/mobile-browser`; a mobile client
  consumes host APIs only through the host API its ABI defines.
- Do not import server/main internals from workspace client code.
- Client source is part of the workspace semantic graph. Read
  [vibestudio-vcs](../vibestudio-vcs/SKILL.md), work against a specific working
  head, build or test that state, commit the complete local chain, and publish
  only after ancestry/integration validation and approval.
- Local builds and tests are feedback only. Protected publication reruns the
  build, typecheck, and authority checks on the exact candidate; builds after
  publication are derived from it. Use managed move/copy operations, which
  preserve file identity and provenance; editing files directly on disk does
  not bypass this flow.

## Client Kits

Shared chrome is not rewritten per client. Five framework-free cores hold the
state machines and pure derivations behind small ports; one kit per runtime
holds that runtime's components built on them. A new client composes them.

| Core                                   | `client-kit-web` | `client-kit-native` | `client-kit-terminal` |
| -------------------------------------- | ---------------- | ------------------- | --------------------- |
| `approvals-core`: queue, decisions, protected inputs, card and trust-change model | approval card, install review, full-surface dialog | approval sheet | approvals overlay |
| `connection-core`: availability, reconnect | `ConnectionNotice` | `ConnectionBar` | `ConnectionStatus` |
| `workspace-core`: list, filter, switch | (desktop switcher stays app-specific) | `WorkspaceList` | `WorkspacePicker` |
| `client-update-core`: ready builds, apply, roll back | `ClientUpdatePrompt` | `presentClientUpdates` | `ClientUpdatePrompt` |
| `provider-signin-core`: device code, browser callback, paste-back, OAuth callback hand-off | `DeviceCodeBody` | sign-in panel | `SignInDetail` |

`@workspace/snapshot-store` is the one subscribable cell every core exposes
(`getSnapshot` / `subscribe`, the shape React's `useSyncExternalStore` takes).

Rules for client authors:

- A core never talks to a host. It takes a port (`ConnectionPort`,
  `WorkspacePort`, `ClientUpdatePort`, `SignInPort`, an RPC client for
  approvals) that the client wires from its own host API. Do not add a second
  wiring path inside a kit.
- Approval decisions come from `approvalDecisionOptions`; never build a
  decision list in a component. A capability approval that carries
  `trustChange` is a critical, per-operation decision: render
  `trustChangeSection(approval)` (the kits' trust-change section does) and offer
  only once or deny.
- Protected inputs (`client-config`, `credential-input`, `secret-input`) are
  typed only into trusted chrome. Route every key and paste to
  `editProtectedInput` while one is shown, send values only through
  `submitProtectedInput`, and never to a session, log or untrusted surface.

## Choosing Clients vs Panels vs Extensions

Use a client when the code is a trusted top-level program a host runs:

- the desktop, mobile or terminal browser
- a dedicated client such as a chat client with its own intents
- anything that renders approvals or owns a device session

Use a panel for a workspace surface shown inside a browser. Use an extension
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
Trusted clients that host panels use the shared registry, which owns the whole
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
