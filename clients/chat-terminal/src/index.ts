/**
 * Vibestudio chat for the terminal: the conversation as the program of this
 * terminal.
 *
 * The terminal host (`vibestudio chat`) verifies this client's built artifact,
 * imports it in-process and calls `run(host)` (ABI `terminal-host-1`; the host
 * checks the manifest's `hostAbi` before it runs anything). The chat owns the
 * terminal until `run` settles; the host guards and restores the TTY and
 * owns Ctrl-C and process signals, which arrive as `host.signal`.
 */
import type {
  TerminalClientExit,
  TerminalClientHost,
} from "@vibestudio/shell-core/terminal/terminalClientHost";
import { runChat } from "./run.js";

export async function run(host: TerminalClientHost): Promise<TerminalClientExit> {
  return runChat(host);
}
