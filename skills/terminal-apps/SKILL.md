---
name: terminal-apps
description: Build or change a terminal app — a worker whose Durable Object renders an Ink UI in the Vibestudio terminal browser — or explain how people use the terminal browser.
---

# Terminal apps

A terminal app is a sandboxed worker that renders an [Ink](https://github.com/vadimdemedes/ink)
UI. People open it from the terminal browser (`vibestudio terminal`): every
worker that declares `vibestudio.terminal` appears in its launcher. The browser
is trusted chrome; your app's bytes never reach the real terminal, they are
drawn into a grid the browser composes.

Reference implementation: `workers/terminal-server-logs` (a live, filterable
server-log tail). Read it before writing a new app.

## Manifest

```jsonc
"vibestudio": {
  "entry": "index.tsx",
  "durable": { "classes": [{ "className": "MyAppSession" }] },
  "terminal": {
    "renderer": "ink",
    "title": "My App",                          // ≤ 60 characters
    "description": "What it is for, in one sentence.",
    "icon": "🧭"                                 // optional, one emoji
    // "className": "MyAppSession"               // only with several durable classes
  }
}
```

Dependencies: `@workspace/runtime`, `@workspace/terminal-shim`,
`@workspace/terminal-host-protocol`, `ink`, `react`. The build validates the
block and names the field to fix when it is wrong.

## Session Durable Object

One DO instance is one session (object key = session id). Implement
`TerminalSession` by forwarding each method to `InkTerminalSessionHost`,
passing `this.caller?.callerId` so only the attached browser can drive the
session. Copy the six `@rpc` methods from `workers/terminal-server-logs/index.tsx`
unchanged: `terminalAttach`, `terminalInput`, `terminalResize`,
`terminalFocus`, `terminalReply`, `terminalClose`.

```tsx
private readonly terminal = new InkTerminalSessionHost({
  render: (session) => <MyApp session={session} />,
  onClose: () => this.deleteStateValue("view"), // user ended the session
});
```

## Rules

- **Rebuild from durable state.** `render` runs on every attach, including a
  resume on another device after the DO was evicted. Keep anything that must
  survive (filters, cursor, channel ids) in DO state, never in memory only.
- **Size.** Use `useTerminalSize()` from `@workspace/terminal-shim` for
  full-screen layouts; render exactly `rows` lines and truncate long lines.
- **Keys.** Use Ink's `useInput`. Every key except the user's prefix key
  (Ctrl-Space by default) reaches you. Show your keys on screen.
- **Host requests.** `session.openUrl(url)` and `session.requestFile(prompt)`
  ask the user in browser chrome and resolve `false`/`null` when declined or
  detached. Never open URLs or read files another way.
- **Attention.** `session.setAttention({ reason })` badges a background tab;
  clear it with `null` when `onFocusChange` reports focus.
- **Approvals.** Gated calls raise approvals the browser shows in its own
  overlay. Never draw an approval prompt yourself; explain in your UI that an
  approval may be waiting.
- **Ending.** `session.end(reason)` (or Ink's `useApp().exit()`) closes the tab
  and removes the session from the resume list.

## Testing

Attach an `InkTerminalSessionHost` directly in a Vitest test, read the
returned stream with `TerminalEventDecoder`, and drive it with `host.input` —
see `workers/terminal-server-logs/LogViewer.test.tsx`. Run it with
`verify` like any unit.

Full protocol and browser architecture: `docs/terminal-apps.md` in the
Vibestudio repository.
