import React from "react";
import { useStdout } from "ink";
import type { TerminalSize } from "@workspace/terminal-host-protocol";

/**
 * The session's current viewport, re-rendering on every browser resize. Ink
 * re-lays-out on resize by itself, but components that size themselves (a
 * full-height list, a scroll window) need the numbers as React state.
 */
export function useTerminalSize(): TerminalSize {
  const { stdout } = useStdout();
  const read = (): TerminalSize => ({ columns: stdout.columns ?? 80, rows: stdout.rows ?? 24 });
  const [size, setSize] = React.useState(read);
  React.useEffect(() => {
    const onResize = () => setSize(read());
    stdout.on("resize", onResize);
    return () => {
      stdout.off("resize", onResize);
    };
  }, [stdout]);
  return size;
}
