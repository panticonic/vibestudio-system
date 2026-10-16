/**
 * Vibestudio terminal browser — the TTY counterpart of the desktop shell.
 *
 * The terminal host (`vibestudio terminal`) verifies this client's built
 * artifact, imports it in-process and calls `run(host)` (ABI `terminal-host-1`:
 * `@vibestudio/shell-core/terminal/terminalClientHost`; the host checks the
 * manifest's `hostAbi` before it runs anything). The browser owns the terminal
 * until `run` settles and always hands it back restored; it never exits the
 * process.
 */
import type {
  TerminalClientExit,
  TerminalClientHost,
} from "@vibestudio/shell-core/terminal/terminalClientHost";
import { TerminalBrowser } from "./browser.js";

export async function run(host: TerminalClientHost): Promise<TerminalClientExit> {
  return new TerminalBrowser(host).run();
}
