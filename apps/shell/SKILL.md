---
name: workspace-shell-app
description: Develop and diagnose the trusted Electron shell in apps/shell, including panel chrome, lifecycle projections, device pairing, and desktop/mobile parity.
---

# Workspace Shell App

`apps/shell` hosts the desktop panel chrome and the device-management UI.

## Workspace clients

- Workspace UI reads and actions use the client returned by
  `useShellWorkspaceClient()`. Command implementations receive that same
  client; they must not import the startup `panel`, `quickfire`, or
  notification services.
- Hold on to the captured client for the whole asynchronous operation,
  including error reporting, so that a focus change cannot redirect an
  in-flight action to another workspace.
- The startup System client handles app and account presentation. Personal,
  System, and shared panel trees all use the same workspace runtime and
  projection events. A workspace's role decides which services it has, not
  which panel code path it uses.
- Direct user notifications already arrive through the workspace UI sessions.
  Don't also send them on a workspace broadcast or add another startup
  forwarding path.

## Devices Surface

- "Connect a device" calls `hubControl.pairDevice` on the currently connected
  server, local or remote. The desktop only brokers the pairing; it never
  relays data.
- Render the HTTPS pair URL and QR code from the complete invite object. Don't
  build fallback links on the client or accept a null `deepLink`/`room`.
- The modal shows the expiry, the server/workspace label, a waiting state, and
  then the paired device. `hubControl.awaitPairing({ code })` settles on the
  invite's lifecycle: `paired` with the device record when it is redeemed, or
  `expired`/`cancelled` when it ends unredeemed. Don't poll `listDevices`.
- Revoke devices with `hubControl.revokeDevice`. The server ends a revoked
  device's sessions with the token-revoked close (4001); the desktop host
  forgets its stored credential and relaunches on that close, whether the
  revocation came from this desktop or another device. The shell does nothing
  extra after revoking its own device. A revoked phone should go back to
  recovery/re-pair.

## Remote Parity

- Remote sessions serve panels, manifests, and assets through the
  bridge-backed facade. Don't assume the server's workspace path is readable on
  the desktop filesystem.
- Pairing URLs can arrive through the desktop protocol handler or be typed in;
  both must go through the shared parser.
- A paired desktop keeps one hub-control identity and selects remote
  workspaces through it. Never tell the user to pair again just to switch
  workspaces.
- Connection settings show the saved auto-reconnect identity by default. The
  pairing form is behind progressive disclosure, for deliberately replacing the
  server, and its copy says explicitly that it overwrites and relaunches.

## Shared Shell Helpers

- Confirmations use `confirmAction` / `confirmClosePanel` from
  `components/ConfirmDialog` (rendered by `ConfirmDialogHost` in `App`), never
  `window.confirm` or `window.prompt` (Electron has no `prompt`). Closing a
  panel always uses the wording `Close "X" and its N sub-panels?`.
- Errors shown to people go through `utils/userFacingError`. Don't render
  `String(error)` or write a per-file message helper.
- Connection status wording lives in `components/connectionStatusCopy`; both
  the title-bar badge and Settings use it.

## Mobile Parity

- The desktop shell and `apps/mobile` are two clients of the same workspace
  model. Before finishing a user-facing shell change, check the mobile
  equivalent: title bar/AppBar, panel tree/drawer, approvals, launcher and
  about/new flows, browser favicons, and loading/error/empty states.
- Share data and presentation rules between clients, but not renderer
  components (with one exception, below). Add a focused behavioral test in
  every affected client. If a surface has no mobile equivalent, say so
  explicitly.
- Command palette and quickfire: the desktop overlay
  (`components/QuickfireOwner` and `overlay/QuickfireSurface`) and the mobile
  `CommandSheet` / `QuickfireSheet` render the same model. Ranking lives in
  `@workspace/omnibox-core`. The slate's _definitions_, the row projection, the
  transcript projection, and the session lifecycle live in
  `@workspace/quickfire-core`. Each client provides only its `run`
  implementations and its renderer, so a new command is one definition plus two
  runs, never a second definition.
- **The exception: the conversation's component tree is shared.**
  `@workspace/quickfire-core/ui` renders the heading, transcript, tool records,
  and Markdown once, against a _skin_: a small set of semantic primitives
  (`Box`/`Text`/`Pressable`/`Disclosure`/`Code`/…) that each client implements
  natively (`apps/shell/overlay/domSkin.tsx`,
  `apps/mobile/src/components/overlay/nativeSkin.tsx`). This replaced two
  hand-written transcripts that had drifted apart in ways unrelated to the
  platform: one showed a tool's failure text and the other didn't, one merged a
  notice's detail into its heading, and they parsed Markdown differently. The
  rule: shared components name no DOM element, React Native view, colour, or
  font, and a skin makes no product decisions. If a style rule needs to know it
  is styling a transcript message, or a shared component needs a `Platform.OS`
  check, the split is in the wrong place.
- The palette itself is _not_ shared, on purpose: a keyboard-driven card with
  ghost completion and a bottom-anchored sheet with no keyboard are different
  UIs over the same row model.
- Surface flags record parity. If a command's `surfaces` omit `"mobile"`, a
  comment on the definition must say why. Currently desktop-only, beyond those
  the spec lists: `view.accent` (mobile has no accent system) and
  `app.check-updates` (mobile updates go through the trusted OTA prompt, not a
  command). Mobile also changes two behaviors on purpose: `workspace.switch`
  opens Settings instead of re-routing from a search field, and the `/` scope
  hands off to the full-height quickfire sheet instead of rendering inline.
- There is one omnibox ranking path. `@workspace/omnibox-core` ranks
  `about/new`, the palette's `@` scope, the title bar's address autocomplete,
  and the mobile address field. `@vibestudio/shared/panelChrome` holds only
  chrome _facts_ (address parsing, history/bookmark normalization and merging)
  and must not grow a second row builder. The prefix grammar is the same
  everywhere: `>` commands, `@` go to, `/` quickfire, no prefix for mixed
  results. `about/new` has no command slate, so for one release its `>` is a
  deprecated alias for `@` and shows a hint row saying so.
- Palette history comes from `panel.getBrowserAddressOptions`, the same call
  the address bar makes. Provider rows feed the shared web-search suggestions
  and never appear as history destinations. Palette rows show only glyphs, so
  they don't fetch favicons. Web actions create children of the bound panel.
- Some slate commands are deliberately missing because the feature behind them
  doesn't exist yet: `panel.move` (the placement engine in
  `layout/placementEngine.ts` has no directional move action, only
  `move-pane-to-new-column`), `panel.collapse` (the layout model has no
  collapse concept), and `authority.pause-agents` / `authority.lock` (the shell
  requests no `permissions.*` capability; adding them expands the authority
  manifest, not just the UI). Add the underlying action or capability first,
  then the command.

## Panel Lifecycle and UI Projections

- `view.createPanel` and `panel.createPanel` resolve once the panel's slot is
  committed. Preparing the runtime image, native attachment, navigation, and
  app boot continue after that. Don't make a create button wait for readiness.
- `panel-created` is the only event that tells you where a new panel was
  placed. It can arrive before the create RPC response, and before a tree or
  presentation read includes the slot. Reducers must be idempotent and merge by
  `panelId`; never add a second optimistic panel when the response arrives.
- Render committed panels immediately in a preparing state. Preparing, ready,
  and failed are derived from the server's lifecycle state; none of them is a
  reason to hide or delete the slot.
- Subscribe to `panel-presentation-changed`, then fetch the changed IDs with a
  single `panel.getPresentations(panelIds)` call. Coalesce bursts by revision
  and ID. Don't refetch the whole panel tree or make one RPC per panel.
- Focus, presentation lease acquisition, runtime activation, and boot readiness
  are separate transitions. Shell panel creation only guarantees the first; the
  portable `openPanel(...)` API waits until the panel has booted.
- Approvals and other long-running work must not block the renderer's input
  handling. Async handlers show their own pending/error state, and panel
  creation, focus, navigation, and input elsewhere stay responsive.
- Never add sleeps or polling loops to work around event ordering. The slot
  event records the committed placement, presentation events tell you what to
  refetch, and waiting for readiness uses the server-minted attempt stream.

## Verification

- Run the smallest focused shell tests and browser flow that cover the changed
  behavior.
- Use the repository's desktop-pairing smoke workflow for pairing changes, and
  the full mobile composition smoke only for cross-client changes.
