---
name: appdev
description: Create or modify trusted workspace apps for Electron, React Native, or terminal targets.
---

# Trusted app development

Apps under `apps/` are approved client runtimes. Panels are UI surfaces,
workers and DOs are sandboxed services, and extensions are trusted Node
services.

Desktop and mobile load their approved client implementation from the acting
user's private System workspace. Focusing Personal or a shared workspace
changes the resource session, not the client source. System is regular
workspace source: being in System grants no host authority and no access to
other workspaces.

Native app units, including supervised terminal apps, are hosted only in a
designated System workspace. Other workspaces may contain and build their
source for authoring, but do not stage native app launch reviews or runtime
principals.

Native code runs under the platform's execution rules: on Unix, MXC resource
admission applies; on Windows, native processes run with the host OS user's
permissions. Workspace RPC checks do not imply filesystem or network isolation
for native code.

## Read by task

| Task                                                    | Reference                                                           |
| ------------------------------------------------------- | ------------------------------------------------------------------- |
| Package, manifest, source, dependencies, panel commands | [AUTHORING.md](AUTHORING.md#hosting-panel-contributed-commands)     |
| External dependencies, overrides, and patches           | [workspace dependency resolution](../workspace-dev/DEPENDENCIES.md) |
| Electron, React Native, or terminal contracts           | [TARGETS.md](TARGETS.md)                                            |
| Capability declarations                                 | [CAPABILITIES.md](CAPABILITIES.md)                                  |
| Semantic development and diagnostics                    | [DEV_LOOP.md](DEV_LOOP.md)                                          |
| Native bootstrap, pairing, mobile artifacts             | [MOBILE.md](MOBILE.md)                                              |
| Remote clients and credentials                          | [REMOTE_CLIENTS.md](REMOTE_CLIENTS.md)                              |
| Focused checks and smoke coverage                       | [TESTING.md](TESTING.md)                                            |

Read only references relevant to the target and change.

## Invariants

- Build production-ready apps. Apps are trusted workspace infrastructure, not
  prototypes: persist state, handle errors, request only the authority you
  need, and test edge cases.
- Do not ship hardcoded demo or fake data. Build real empty states, data-entry
  flows, and persistence.
- Do not leave UI stubs without working functionality: no 'share' button unless
  sharing works, no user account badge without an account system, no
  breadcrumbs without navigation.
- `@workspace-apps/<name>` maps to `apps/<name>`. Identity comes from the
  package manifest and approved build, not the display path.
- Give each app a `vibestudio.icon` containing one emoji or a unit-relative
  image path. Use `prepareUnitIcon` or `setUnitIcon` for catalog artwork; never
  store catalog IDs in the manifest. Follow the [icon
  guide](../workspace-dev/references/icons.md). Use `@workspace/ui/icons` for
  host UI icons.
- Declare only the capabilities the target requires and let the normal review
  flow approve them.
- Read [Vibestudio VCS](../vibestudio-vcs/SKILL.md) before editing managed
  source. Check the working head, commit the complete local chain, and publish
  explicitly.
- Electron layout hosts declare `panel-hosting`. React Native pairing must work
  in the shipped bootstrap before a workspace bundle exists. Terminal apps run
  only as explicitly activated supervised processes.
- If an app creates or changes user data, store it persistently unless the user
  says the data is disposable. Keep live interactive data in a Durable Object
  service that owns SQLite. Use version-controlled project files when content
  benefits from history and collaboration. Client component state and process
  memory are presentation state, not persistence.
- Respect the user's live light/dark choice and use responsive layouts. For
  panel UI, follow [the theme contract](../workspace-dev/WORKFLOW.md#theme-and-layout):
  automatic React mounting supplies the theme wrapper, custom CSS must use
  theme-aware colors, and `usePanelTheme()` is for code that needs the current
  appearance. For native client UI, use the target's existing appearance state.
  When creating or restyling UI, verify both appearances and live switching.
- Panel commands are generic and host-local: panels define what a command does;
  apps handle presentation and routing.

## Workflow

For original illustrations, creative content, or other visual assets that
enrich the app (games, learning tools, storytelling, visual exploration),
follow [creative imagery and visual assets](../workspace-dev/SKILL.md#creative-imagery-and-visual-assets).

Create `apps/<name>` with package name `@workspace-apps/<name>` and declare it
under `apps:` in `meta/vibestudio.yml`. Use the live generated docs and
manifest schema for exact fields.

Run the smallest target-specific checks from [TESTING.md](TESTING.md). When a
change affects startup, pairing, shell UI, mobile bootstrap, or client auth,
use the `skills/system-testing/SKILL.md` skill from the optional System Testing
template.

Use [workspace development](../workspace-dev/SKILL.md) for panels and workers,
and [extension development](../extensiondev/SKILL.md) for trusted Node services.
