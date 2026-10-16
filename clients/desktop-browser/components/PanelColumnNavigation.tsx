import { ChevronLeftIcon, ChevronRightIcon } from "@radix-ui/react-icons";
import { Button, Flex, Text } from "@radix-ui/themes";
import type { PanelLayout } from "../layout/types";

/** Overflow is a window onto a fixed order, with explicit controls to reveal it. */
export function PanelColumnNavigation({
  layout,
  residentColumnIds,
  titleOf,
  onRevealColumn,
}: {
  layout: PanelLayout;
  residentColumnIds: string[];
  titleOf: (panelId: string) => string;
  onRevealColumn: (columnId: string) => void;
}) {
  if (residentColumnIds.length === 0 || residentColumnIds.length === layout.columns.length)
    return null;
  const start = layout.columns.findIndex((column) => column.id === residentColumnIds[0]);
  const end = start + residentColumnIds.length - 1;
  const previous = layout.columns[start - 1];
  const next = layout.columns[end + 1];
  const columnTitle = (column: typeof previous) =>
    column?.panes.map((pane) => titleOf(pane.panelId)).join(", ");

  return (
    <Flex
      role="navigation"
      aria-label="Panel columns"
      align="center"
      justify="between"
      gap="2"
      px="2"
      py="1"
      style={{ flexShrink: 0, borderBottom: "1px solid var(--gray-a5)" }}
    >
      <Button
        size="1"
        variant="ghost"
        disabled={!previous}
        aria-label="Show previous panel column"
        title={previous ? `Show ${columnTitle(previous)}` : undefined}
        onClick={() => previous && onRevealColumn(previous.id)}
      >
        <ChevronLeftIcon /> {start} left
      </Button>
      <Text size="1" color="gray">
        Columns {start + 1}–{end + 1} of {layout.columns.length}
      </Text>
      <Button
        size="1"
        variant="ghost"
        disabled={!next}
        aria-label="Show next panel column"
        title={next ? `Show ${columnTitle(next)}` : undefined}
        onClick={() => next && onRevealColumn(next.id)}
      >
        {layout.columns.length - end - 1} right <ChevronRightIcon />
      </Button>
    </Flex>
  );
}
