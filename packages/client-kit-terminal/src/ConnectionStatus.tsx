import React from "react";
import { Text } from "ink";
import { connectionStatusLine, type ConnectionTone, type ConnectionView } from "@workspace/connection-core";

const TONE_COLOR: Record<ConnectionTone, "green" | "yellow" | "red"> = {
  ok: "green",
  pending: "yellow",
  problem: "red",
};

/** The status line's connection words, lower-case to sit between other status text. */
export function connectionStatusText(view: ConnectionView): { text: string; color: "green" | "yellow" | "red" } {
  const line = connectionStatusLine(view);
  const label = line.label.replace(/…$/, "").toLowerCase();
  return {
    text: line.detail ? `${label} (${line.detail})` : label,
    color: TONE_COLOR[line.tone],
  };
}

/** The connection part of a terminal client's status line. */
export function ConnectionStatus({ view }: { view: ConnectionView }): React.ReactElement {
  const { text, color } = connectionStatusText(view);
  return <Text color={color}>{text}</Text>;
}
