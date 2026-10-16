import React from "react";
import { Box, Text } from "ink";
import { clientUpdateMessage, type PendingClientUpdate } from "@workspace/client-update-core";
import { ButtonRow, type Button } from "./clickable.js";

/**
 * The pending update a terminal host reports (`host.update`), in the shape the
 * prompt shows. The terminal host holds no rollback targets, so none is offered.
 */
export function terminalPendingUpdate(
  client: { id: string; source: string },
  update: { buildKey: string; effectiveVersion: string | null }
): PendingClientUpdate {
  return {
    clientId: client.id,
    source: client.source,
    runtime: "terminal",
    buildKey: update.buildKey,
    toVersion: update.effectiveVersion,
    fromVersion: null,
    canRollback: false,
  };
}

/**
 * The update prompt a terminal client offers at a safe point: what is ready, and
 * the two answers. A terminal client cannot swap its running build mid-session,
 * so the answers are "restart now" (the host relaunches into the new build) and
 * "later" (the new build is used at next launch).
 */
export function clientUpdateButtons(update: PendingClientUpdate): Button[] {
  return [
    {
      id: `update:${update.clientId}:restart`,
      label: "[r] Restart now",
      action: { key: "r", confirm: true },
      color: "green",
    },
    { id: `update:${update.clientId}:later`, label: "[l] Later", action: { key: "l" } },
  ];
}

export function ClientUpdatePrompt({
  update,
  width,
}: {
  update: PendingClientUpdate;
  width: number;
}): React.ReactElement {
  return (
    <Box flexDirection="column" width={width}>
      <Text wrap="truncate-end">
        <Text bold color="cyan">
          Update ready
        </Text>
        <Text>{` · ${clientUpdateMessage(update)}`}</Text>
      </Text>
      <ButtonRow buttons={clientUpdateButtons(update)} />
    </Box>
  );
}
