/**
 * Vibestudio terminal browser — the TTY counterpart of the desktop shell.
 *
 * The `vibestudio terminal` CLI fetches this app's built artifact, imports it
 * in-process and calls `run(host)` (contract:
 * `@vibestudio/shell-core/terminal/terminalBrowserHost`). The browser owns the
 * terminal until `run` settles and always hands it back restored; it never
 * exits the process.
 */
import {
  TERMINAL_BROWSER_HOST_CONTRACT_VERSION,
  type TerminalBrowserExit,
  type TerminalBrowserHost,
} from "@vibestudio/shell-core/terminal/terminalBrowserHost";
import { TerminalBrowser } from "./browser.js";

export async function run(host: TerminalBrowserHost): Promise<TerminalBrowserExit> {
  if (host.contractVersion !== TERMINAL_BROWSER_HOST_CONTRACT_VERSION) {
    throw new Error(
      `This terminal browser speaks host contract v${TERMINAL_BROWSER_HOST_CONTRACT_VERSION}, but the CLI offers v${String(
        host.contractVersion
      )}. Update the Vibestudio CLI or the workspace's System template so they match.`
    );
  }
  return new TerminalBrowser(host).run();
}
