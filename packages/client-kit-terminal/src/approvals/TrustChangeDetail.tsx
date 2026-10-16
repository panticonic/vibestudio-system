import React from "react";
import { Box, Text } from "ink";
import type { PendingApproval } from "@vibestudio/shared/approvals";
import { trustChangeSection } from "@workspace/approvals-core";

/**
 * The structured trust-change section of a critical approval: for each client
 * its name, icon and runtime, the device-level powers it gains or loses in the
 * catalog's plain words, and the version it is pinned to. Nothing is offered
 * here beyond the one-time approve/deny the card's own decisions give.
 */
export function TrustChangeDetail({
  approval,
}: {
  approval: PendingApproval;
}): React.ReactElement | null {
  const section = trustChangeSection(approval);
  if (!section) return null;
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold color="yellow">
        {section.heading}
      </Text>
      <Text wrap="wrap">{section.summary}</Text>
      {section.entries.map((entry) => (
        <Box key={entry.source} flexDirection="column" marginTop={1}>
          <Text bold wrap="wrap">
            {`${entry.icon ? `${entry.icon} ` : ""}${entry.name} · ${entry.runtimeLabel}`}
          </Text>
          <Text dimColor wrap="wrap">{`${entry.source} · ${entry.pinnedLine}`}</Text>
          {entry.gained.length > 0 ? (
            <Box flexDirection="column">
              <Text>{`  ${section.labels.gained}:`}</Text>
              {entry.gained.map((power) => (
                <Text key={power.capability} wrap="wrap">{`    + ${power.summary}`}</Text>
              ))}
            </Box>
          ) : null}
          {entry.lost.length > 0 ? (
            <Box flexDirection="column">
              <Text>{`  ${section.labels.lost}:`}</Text>
              {entry.lost.map((power) => (
                <Text key={power.capability} wrap="wrap">{`    − ${power.summary}`}</Text>
              ))}
            </Box>
          ) : null}
        </Box>
      ))}
      <Text dimColor wrap="wrap">
        {section.decisionNote}
      </Text>
    </Box>
  );
}
