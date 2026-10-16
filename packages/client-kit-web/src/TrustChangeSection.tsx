/**
 * The trust-change section of a capability approval
 * (docs/client-hosts-and-clients-plan.md §4.4.1, "Present"): for each client,
 * who it is, the device-level powers it gains or loses in plain words, and the
 * exact build it is pinned to. Every word comes from the core's
 * `trustChangeSection`; this only draws it.
 */
import { Box, Flex, Text } from "@radix-ui/themes";
import { ExclamationTriangleIcon } from "@radix-ui/react-icons";
import { UnitIcon } from "./UnitIcon";
import type { TrustChangeEntry, TrustChangeSection as Section } from "@workspace/approvals-core";

function PowerList({
  label,
  powers,
  kind,
}: {
  label: string;
  powers: TrustChangeEntry["gained"];
  kind: "gained" | "lost";
}) {
  if (powers.length === 0) return null;
  return (
    <Flex direction="column" gap="1" data-trust-powers={kind}>
      <Text size="1" weight="medium">
        {label}
      </Text>
      <ul style={{ margin: 0, paddingLeft: 18 }}>
        {powers.map((power) => (
          <li key={power.capability}>
            <Text size="1">{power.summary}</Text>
          </li>
        ))}
      </ul>
    </Flex>
  );
}

export function TrustChangeSection({ section }: { section: Section }) {
  return (
    <Flex
      direction="column"
      gap="2"
      mt="1"
      p="2"
      className="approval-trust-change"
      role="group"
      aria-label={section.heading}
      style={{
        border: "1px solid var(--red-a6)",
        borderRadius: 6,
        background: "var(--red-a2)",
      }}
    >
      <Flex align="center" gap="1" style={{ color: "var(--red-11)" }}>
        <ExclamationTriangleIcon width={13} height={13} aria-hidden />
        <Text size="1" weight="bold">
          {section.heading}
        </Text>
      </Flex>
      <Text size="1" color="gray">
        {section.summary}
      </Text>
      {section.entries.map((entry) => (
        <Flex
          key={`${entry.runtime}:${entry.source}`}
          direction="column"
          gap="1"
          data-trust-client={entry.source}
        >
          <Flex align="center" gap="2" wrap="wrap">
            <UnitIcon icon={entry.icon} source={entry.source} size={16} fallback="client" />
            <Text size="2" weight="bold">
              {entry.name}
            </Text>
            <Text size="1" color="gray">
              {entry.runtimeLabel}
            </Text>
          </Flex>
          <Text size="1" color="gray">
            {entry.headline}
          </Text>
          <PowerList label={section.labels.gained} powers={entry.gained} kind="gained" />
          <PowerList label={section.labels.lost} powers={entry.lost} kind="lost" />
          <Text size="1" color="gray">
            {entry.pinnedLine}
          </Text>
        </Flex>
      ))}
      <Box>
        <Text size="1" weight="medium">
          {section.decisionNote}
        </Text>
      </Box>
    </Flex>
  );
}
