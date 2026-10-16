import React from "react";
import { Box, Text } from "ink";

/** Which characters of an item's label matched the query, for highlighting. */
export interface ListMatch {
  positions: number[];
}

export interface ListItem {
  key: string;
  label: string;
  /** Second, dimmed line (launcher descriptions). */
  detail?: string;
  /** Right-aligned hint, e.g. "resume", "running", "C-Space a". */
  hint?: string;
  section?: string;
  match?: ListMatch;
}

export interface ListOverlayProps {
  title: string;
  query: string;
  placeholder: string;
  items: ListItem[];
  selected: number;
  width: number;
  height: number;
  /** Shown instead of the list when there is nothing to show at all. */
  empty: React.ReactNode;
  footer: string;
  border?: boolean;
}

function Highlighted({
  text,
  positions,
}: {
  text: string;
  positions?: number[];
}): React.ReactElement {
  if (!positions || positions.length === 0) return <>{text}</>;
  const set = new Set(positions);
  const parts: React.ReactElement[] = [];
  let run = "";
  let runMatched = false;
  const flush = (key: number) => {
    if (!run) return;
    parts.push(
      runMatched ? (
        <Text key={key} color="cyan" bold>
          {run}
        </Text>
      ) : (
        <React.Fragment key={key}>{run}</React.Fragment>
      )
    );
    run = "";
  };
  [...text].forEach((char, index) => {
    const matched = set.has(index);
    if (matched !== runMatched) {
      flush(index);
      runMatched = matched;
    }
    run += char;
  });
  flush(text.length);
  return <>{parts}</>;
}

/**
 * One geometry for painting a list overlay and hit testing it, like
 * `tabWindow`: which items show, and the overlay-relative row each one starts
 * on (a section header takes the row above its first item).
 */
export function listWindow(
  items: readonly Pick<ListItem, "detail" | "section">[],
  selected: number,
  height: number,
  border = true
): {
  first: number;
  capacity: number;
  rowsPerItem: number;
  listRows: number;
  rows: { index: number; y: number }[];
} {
  const inner = Math.max(1, height - (border ? 2 : 0));
  const rowsPerItem = items.some((item) => item.detail) ? 2 : 1;
  const sections = new Set(items.map((item) => item.section).filter(Boolean)).size;
  const listRows = Math.max(1, inner - 3);
  const capacity = Math.max(1, Math.floor((listRows - Math.min(sections, 2)) / rowsPerItem));
  const first = Math.min(
    Math.max(0, selected - Math.floor(capacity / 2)),
    Math.max(0, items.length - capacity)
  );
  // Below the border, the title and the query line.
  const top = (border ? 1 : 0) + 2;
  const rows: { index: number; y: number }[] = [];
  let y = top;
  let lastSection: string | undefined;
  for (let index = first; index < Math.min(items.length, first + capacity); index++) {
    const item = items[index]!;
    if (item.section && item.section !== lastSection) y++;
    lastSection = item.section;
    if (y >= top + listRows) break;
    rows.push({ index, y });
    y += rowsPerItem;
  }
  return { first, capacity, rowsPerItem, listRows, rows };
}

/** The item whose rows cover overlay-relative row `y`, if any. */
export function listItemAt(window: ReturnType<typeof listWindow>, y: number): number | null {
  const row = window.rows.find((row) => y >= row.y && y < row.y + window.rowsPerItem);
  return row ? row.index : null;
}

export function ListOverlay(props: ListOverlayProps): React.ReactElement {
  const { items, selected, width, height } = props;
  const { first, capacity, rowsPerItem, listRows } = listWindow(
    items,
    selected,
    height,
    props.border !== false
  );
  const visible = items.slice(first, first + capacity);
  let lastSection: string | undefined;
  return (
    <Box
      flexDirection="column"
      width={width}
      height={height}
      borderStyle={props.border === false ? undefined : "round"}
      borderColor="cyan"
      paddingX={1}
    >
      <Box justifyContent="space-between">
        <Text bold color="cyan">
          {props.title}
        </Text>
        {items.length > capacity ? <Text dimColor>{`${selected + 1}/${items.length}`}</Text> : null}
      </Box>
      <Text wrap="truncate-end">
        <Text color="cyan">{"› "}</Text>
        {props.query ? <Text>{props.query}</Text> : <Text dimColor>{props.placeholder}</Text>}
        <Text inverse> </Text>
      </Text>
      <Box flexDirection="column" height={listRows} overflow="hidden">
        {items.length === 0
          ? props.empty
          : visible.map((item, offset) => {
              const index = first + offset;
              const header = item.section && item.section !== lastSection ? item.section : null;
              lastSection = item.section;
              return (
                <Box key={item.key} flexDirection="column" flexShrink={0}>
                  {header ? (
                    <Text dimColor bold>
                      {header}
                    </Text>
                  ) : null}
                  <Box justifyContent="space-between">
                    <Text inverse={index === selected} wrap="truncate-end">
                      {index === selected ? "▸ " : "  "}
                      <Highlighted text={item.label} positions={item.match?.positions} />
                    </Text>
                    {item.hint ? <Text dimColor>{` ${item.hint}`}</Text> : null}
                  </Box>
                  {rowsPerItem === 2 ? (
                    <Text dimColor wrap="truncate-end">
                      {`    ${item.detail ?? ""}`}
                    </Text>
                  ) : null}
                </Box>
              );
            })}
      </Box>
      <Text dimColor wrap="truncate-end">
        {props.footer}
      </Text>
    </Box>
  );
}
