/**
 * Replacement for the `terminal-size` npm package inside workerd.
 *
 * The real package shells out through `node:child_process`, which workerd
 * does not provide. Ink consults it only when its stdout reports no
 * `columns`; every terminal session stream carries its own size, so this
 * fallback is never the source of truth and holds no per-session state.
 */
export interface TerminalSize {
  columns: number;
  rows: number;
}

export default function terminalSize(): TerminalSize {
  return { columns: 80, rows: 24 };
}
