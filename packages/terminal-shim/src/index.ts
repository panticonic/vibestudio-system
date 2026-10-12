/**
 * @workspace/terminal-shim — everything a terminal app needs to render Ink
 * inside a workerd Durable Object and speak the terminal session protocol.
 *
 * - `InkTerminalSessionHost`: the protocol implementation a session DO
 *   forwards its `@rpc` methods to (see docs/terminal-apps.md).
 * - `./yoga`, `./node/signal-exit`, `./node/terminal-size`: workerd
 *   replacements the terminal-worker build aliases over `yoga-layout`,
 *   `signal-exit` and `terminal-size`. They hold no per-session state.
 */
export {
  InkTerminalSessionHost,
  type InkTerminalSessionHostOptions,
  type TerminalFile,
  type TerminalSessionHandle,
} from "./InkTerminalSessionHost.js";
export { useTerminalSize } from "./hooks.js";
