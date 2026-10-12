/**
 * Replacement for the `signal-exit` npm package inside workerd.
 *
 * The real package does CommonJS `require('assert')` at module scope, which
 * workerd rejects at startup. A worker has no process exit or signals, so
 * there is nothing to hook: Ink's registration is accepted and never fires.
 * Session teardown unmounts each Ink instance explicitly (see
 * `InkTerminalSessionHost`), so there is no module-level state here that two
 * sessions in one isolate could share.
 */
type ExitHandler = (code: number | null, signal: string | null) => void;

function signalExit(_handler: ExitHandler, _options?: { alwaysLast?: boolean }): () => void {
  return () => {};
}

export default signalExit;
export const onExit = signalExit;
export function load(): void {}
export function unload(): void {}
