---
name: clientdev
description: Create or modify clients, the trusted top-level programs that hosts run on a device, for the web, React Native, or terminal runtime.
---

# Client development

Clients under `clients/` are approved top-level programs. A **host** (desktop,
terminal, Android, iOS) is trusted native code that ships in a binary release;
it downloads, verifies and runs a client. The desktop, mobile and terminal
browsers are clients. Panels are UI surfaces, workers and DOs are sandboxed
services, and extensions are trusted Node services. In user-facing copy, "app"
means a panel.

Each client is built for one **runtime** (`web`, `react-native`, `terminal`)
and declares the **host ABI** it was written against (`web-host-1`,
`rn-host-6`, `terminal-host-1`). A host runs a client only when it implements
that exact ABI and every capability the client marks `required`.

Hosts load their approved clients from the acting user's private System
workspace. Focusing Personal or a shared workspace changes the resource
session, not the client source. System is regular workspace source: being in
System grants no host authority and no access to other workspaces.

Clients are declared and run only from a designated System workspace. Other
workspaces may contain and build their source for authoring, but do not stage
client launch reviews or runtime principals.

Native code runs under the platform's execution rules: on Unix, MXC resource
admission applies; on Windows, native processes run with the host OS user's
permissions. Workspace RPC checks do not imply filesystem or network isolation
for native code.

## Read by task

| Task                                                          | Reference                                                           |
| ------------------------------------------------------------- | ------------------------------------------------------------------- |
| Package, manifest, source, dependencies, panel commands       | [AUTHORING.md](AUTHORING.md#hosting-panel-contributed-commands)     |
| External dependencies, overrides, and patches                 | [workspace dependency resolution](../workspace-dev/DEPENDENCIES.md) |
| Background intent handlers (service recipe)                   | [AUTHORING.md](AUTHORING.md#background-intent-handlers)             |
| Web, React Native, or terminal runtime contracts              | [RUNTIMES.md](RUNTIMES.md)                                          |
| Capability catalog, required vs optional, `trust.clients`     | [CAPABILITIES.md](CAPABILITIES.md)                                  |
| Develop and deploy a client with no restart, diagnostics      | [DEV_LOOP.md](DEV_LOOP.md)                                          |
| React Native host and bundle delivery, pairing                | [MOBILE.md](MOBILE.md)                                              |
| Remote clients and credentials                                | [REMOTE_CLIENTS.md](REMOTE_CLIENTS.md)                              |
| Focused checks and smoke coverage                             | [TESTING.md](TESTING.md)                                            |

Read only references relevant to the runtime and change.

## Invariants

- Build production-ready clients. Clients are trusted workspace
  infrastructure, not prototypes: persist state, handle errors, request only
  the authority you need, and test edge cases.
- Do not ship hardcoded demo or fake data. Build real empty states, data-entry
  flows, and persistence.
- Do not leave UI stubs without working functionality: no 'share' button unless
  sharing works, no user account badge without an account system, no
  breadcrumbs without navigation.
- `@workspace-clients/<name>` maps to `clients/<name>`. Identity comes from the
  package manifest and approved build, not the display path.
- A client's product identity is `vibestudio.client.id`. The unique key is
  `(workspace, id, runtime)`: several runtime variants of one product share an
  `id`, and a duplicate pair is rejected at reconcile.
- Give each client a `vibestudio.icon` containing one emoji or a unit-relative
  image path. Use `prepareUnitIcon` or `setUnitIcon` for catalog artwork; never
  store catalog IDs in the manifest. Follow the [icon
  guide](../workspace-dev/references/icons.md). Use `@workspace/ui/icons` for
  host UI icons.
- Declare capabilities as `required` only when the client cannot run without
  them, and `optional` otherwise. Device-level capabilities need
  `trust.clients` in `meta/vibestudio.yml` (see
  [CAPABILITIES.md](CAPABILITIES.md)).
- A client never holds device secrets. The host owns the device credential,
  the connection and the OS integration; the client receives a one-use,
  build-bound principal grant.
- Read [Vibestudio VCS](../vibestudio-vcs/SKILL.md) before editing managed
  source. Check the working head, commit the complete local chain, and publish
  explicitly.
- Terminal clients run only in the `vibestudio` terminal host as client
  modules, never as server processes.
- If a client creates or changes user data, store it persistently unless the
  user says the data is disposable. Keep live interactive data in a Durable
  Object service that owns SQLite. Use version-controlled project files when
  content benefits from history and collaboration. Client component state and
  process memory are presentation state, not persistence.
- Respect the user's live light/dark choice and use responsive layouts. For
  panel UI, follow [the theme contract](../workspace-dev/WORKFLOW.md#theme-and-layout):
  automatic React mounting supplies the theme wrapper, custom CSS must use
  theme-aware colors, and `usePanelTheme()` is for code that needs the current
  appearance. For native client UI, use the runtime's existing appearance
  state. When creating or restyling UI, verify both appearances and live
  switching.
- Panel commands are generic and host-local: panels define what a command does;
  browsers handle presentation and routing.

## Workflow

For original illustrations, creative content, or other visual assets that
enrich the client (games, learning tools, storytelling, visual exploration),
follow [creative imagery and visual assets](../workspace-dev/SKILL.md#creative-imagery-and-visual-assets).

Create `clients/<name>` with package name `@workspace-clients/<name>` and
declare it under `clients:` in `meta/vibestudio.yml`. Follow
[DEV_LOOP.md](DEV_LOOP.md) to run it on an already-running host without
restarting anything. Use the live generated docs and manifest schema for exact
fields.

Run the smallest runtime-specific checks from [TESTING.md](TESTING.md). When a
change affects startup, pairing, browser UI, mobile bootstrap, or client auth,
use the `skills/system-testing/SKILL.md` skill from the optional System Testing
template.

Use [workspace development](../workspace-dev/SKILL.md) for panels and workers,
and [extension development](../extensiondev/SKILL.md) for trusted Node services.
