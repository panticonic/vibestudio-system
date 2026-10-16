import React from "react";
import { Box, Text } from "ink";
import type { FuzzyMatch } from "../input/fuzzy.js";
import { BINDING_GROUPS, PREFIX_BINDINGS, type Binding } from "../input/keymap.js";
import { SETTING_ROWS, type BrowserSettings } from "../settings.js";
import { Scrollable } from "./Scrollable.js";
import { ButtonRow, type Button } from "./clickable.js";

// ── tab strip ────────────────────────────────────────────────────────────────

export interface TabView {
  title: string;
  icon?: string;
  focused: boolean;
  /** Something in the tab wants the person: a pending approval or attention. */
  badge: string | null;
  /** "ended": the program is not running (it exited). */
  status: "attaching" | "live" | "ended" | "problem";
}

/** One shared geometry for painting and hit testing; focused tabs never overflow off-screen. */
export function tabWindow(
  count: number,
  focused: number,
  width: number
): { first: number; count: number; share: number; inset: number } {
  const capacity = Math.max(1, Math.floor((width - 4) / 8));
  const visible = Math.min(count, capacity);
  const first = Math.min(
    Math.max(0, focused - Math.floor(visible / 2)),
    Math.max(0, count - visible)
  );
  const inset = count > visible ? 2 : 0;
  return {
    first,
    count: visible,
    share: Math.max(1, Math.floor((width - inset * 2) / Math.max(1, visible))),
    inset,
  };
}

export function TabStrip({
  tabs,
  width,
  brand,
}: {
  tabs: TabView[];
  width: number;
  brand: string;
}): React.ReactElement {
  if (tabs.length === 0) {
    return (
      <Box width={width} height={1}>
        <Text bold color="cyan" wrap="truncate-end">
          {` ${brand}`}
        </Text>
      </Box>
    );
  }
  // Give every tab an equal share, at least enough for "N:" and a few letters.
  const { first, count, share, inset } = tabWindow(
    tabs.length,
    tabs.findIndex((tab) => tab.focused),
    width
  );
  return (
    <Box width={width} height={1}>
      {inset ? (
        <Box width={inset}>
          <Text>{first > 0 ? "‹ " : "  "}</Text>
        </Box>
      ) : null}
      {tabs.slice(first, first + count).map((tab, offset) => {
        const index = first + offset;
        const marker = tab.status === "problem" ? "!" : tab.status === "attaching" ? "…" : "";
        const label = `${index + 1}:${tab.icon ? `${tab.icon} ` : ""}${tab.title}${marker}`;
        const room = Math.max(1, share - (tab.badge ? 3 : 1));
        return (
          <Box key={index} width={share} flexShrink={0}>
            <Box width={room} flexShrink={0}>
              <Text
                inverse={tab.focused}
                bold={tab.focused}
                dimColor={tab.status === "ended"}
                wrap="truncate-end"
              >
                {` ${label}`}
              </Text>
            </Box>
            {tab.badge ? (
              <Text color="yellow" bold>
                {` ${tab.badge}`}
              </Text>
            ) : null}
          </Box>
        );
      })}
      {inset ? (
        <Box width={inset}>
          <Text>{first + count < tabs.length ? " ›" : "  "}</Text>
        </Box>
      ) : null}
    </Box>
  );
}

// ── status bar ───────────────────────────────────────────────────────────────

export interface StatusView {
  workspace: string;
  server: string;
  connection: { phase: "connected" | "reconnecting" | "lost"; cause?: string };
  prefixLabel: string;
  prefixPending: boolean;
  /** Mode-specific key hints that replace the defaults (copy mode, launcher, ...). */
  hint?: string;
  /** One-shot message, e.g. "Copied 3 lines"; cleared by the next key. */
  notice?: string | null;
}

export function StatusBar({
  view,
  width,
}: {
  view: StatusView;
  width: number;
}): React.ReactElement {
  if (view.prefixPending) {
    // The menu above lists every key; the bar only says what state this is.
    return (
      <Box width={width} height={1}>
        <Text backgroundColor="yellow" color="black" bold wrap="truncate-end">
          {` ${view.prefixLabel} › press a key from the menu above · Esc cancels `.padEnd(width)}
        </Text>
      </Box>
    );
  }
  const connection =
    view.connection.phase === "connected"
      ? { text: "connected", color: "green" }
      : view.connection.phase === "reconnecting"
        ? {
            text: `reconnecting (${view.connection.cause ?? "connection interrupted"})`,
            color: "yellow",
          }
        : {
            text: `disconnected (${view.connection.cause ?? "server gone"})`,
            color: "red",
          };
  // The way into everything, always in view: a button that opens the menu, named by its key.
  return (
    <Box width={width} height={1} justifyContent="space-between">
      <Box flexShrink={1} flexGrow={1}>
        <Text wrap="truncate-end">
          {/* Most important first: truncation cuts the server address. Approvals have
              their own bar above. */}
          {view.notice ? <Text color="cyan">{` ${view.notice} ·`}</Text> : null}
          <Text bold>{` ${view.workspace}`}</Text>
          <Text dimColor>{" · "}</Text>
          <Text color={connection.color}>{connection.text}</Text>
          <Text dimColor>{` · ${view.server}`}</Text>
        </Text>
      </Box>
      <Box flexShrink={0}>
        {view.hint ? (
          <Text dimColor wrap="truncate-start">{`${view.hint} `}</Text>
        ) : (
          <Text inverse>{statusMenuLabel(view.prefixLabel)}</Text>
        )}
      </Box>
    </Box>
  );
}

/** The status bar's menu button, flush right: a click there opens the menu. */
export function statusMenuLabel(prefixLabel: string): string {
  return ` ${prefixLabel} menu `;
}

// ── list overlays (palette, launcher, workspaces) ──────────────────────────────

export interface ListItem {
  key: string;
  label: string;
  /** Second, dimmed line (launcher descriptions). */
  detail?: string;
  /** Right-aligned hint, e.g. "resume", "running", "C-Space a". */
  hint?: string;
  section?: string;
  match?: FuzzyMatch;
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

// ── needs you ────────────────────────────────────────────────────────────────

/**
 * The bar above the status bar while the focused tab's work waits on an
 * approval. The browser draws it, so no program can fake or hide it; the way
 * to answer comes first, so a narrow terminal cuts the title, not the key.
 */
export function NeedsYouBar({
  headline,
  more,
  prefixLabel,
  width,
}: {
  headline: string;
  more: number;
  prefixLabel: string;
  width: number;
}): React.ReactElement {
  // The whole bar is the button: its fill says so; the key is the other way in.
  const key = ` ${prefixLabel} a `;
  return (
    <Box width={width} height={1}>
      <Box flexGrow={1} flexShrink={1}>
        <Text backgroundColor="yellow" color="black" bold wrap="truncate-end">
          {` ! Approval: ${headline}${more > 0 ? ` (+${more} more)` : ""} `.padEnd(
            Math.max(0, width - key.length)
          )}
        </Text>
      </Box>
      <Box flexShrink={0}>
        <Text backgroundColor="yellow" color="black">
          {key}
        </Text>
      </Box>
    </Box>
  );
}

// ── prefix menu ──────────────────────────────────────────────────────────────

type MenuSegment = {
  text: string;
  tone?: "key" | "title" | "head" | "dim";
  /** The command this cell runs, so a click finds it where it is painted. */
  binding?: Binding;
};

const MENU_GAP = 3;

function wordWrap(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (!line) line = word;
    else if (line.length + 1 + word.length <= width) line += ` ${word}`;
    else {
      lines.push(line);
      line = word;
    }
    while (line.length > width) {
      lines.push(line.slice(0, width));
      line = line.slice(width);
    }
  }
  return [...lines, line];
}

/**
 * Every prefix command with its full description, grouped. Descriptions are
 * never cut: a cell too narrow for one wraps it. The fewest columns that fit
 * in `maxRows` win (one column reads best); a short terminal gets more.
 * Lines are inside the border, so the panel's height is `lines.length + 2`.
 */
export function prefixMenuLines(
  prefixLabel: string,
  width: number,
  maxRows = Number.POSITIVE_INFINITY
): MenuSegment[][] {
  const inner = Math.max(10, width - 4);
  let best: MenuSegment[][] | null = null;
  for (let columns = 1; columns <= 3; columns++) {
    const cellWidth = Math.floor((inner - MENU_GAP * (columns - 1)) / columns);
    if (columns > 1 && cellWidth < 24) break;
    const lines = menuLinesIn(prefixLabel, inner, columns, cellWidth);
    if (lines.length <= maxRows) return lines;
    if (!best || lines.length < best.length) best = lines;
  }
  return best!;
}

function menuLinesIn(
  prefixLabel: string,
  inner: number,
  columns: number,
  cellWidth: number
): MenuSegment[][] {
  const keyWidth = Math.max(...PREFIX_BINDINGS.map((b) => b.key.length)) + 1;
  const lines: MenuSegment[][] = [
    ...wordWrap(`${prefixLabel} — the browser menu. Press one of these keys:`, inner).map(
      (text) => [{ text, tone: "head" as const }]
    ),
  ];
  const cell = (binding: Binding): MenuSegment[][] => {
    const description = wordWrap(binding.description, Math.max(1, cellWidth - keyWidth - 1));
    return description.map((text, index) => [
      {
        text: (index === 0 ? binding.key : "").padEnd(keyWidth + 1),
        tone: "key",
        binding,
      },
      { text: text.padEnd(cellWidth - keyWidth - 1), binding },
    ]);
  };
  for (const group of BINDING_GROUPS) {
    const bindings = PREFIX_BINDINGS.filter((binding) => binding.group === group.id);
    lines.push([], [{ text: group.title, tone: "title" }]);
    for (let start = 0; start < bindings.length; start += columns) {
      const cells = bindings.slice(start, start + columns).map(cell);
      const height = Math.max(...cells.map((c) => c.length));
      for (let row = 0; row < height; row++) {
        const line: MenuSegment[] = [];
        cells.forEach((c, index) => {
          if (index > 0) line.push({ text: " ".repeat(MENU_GAP) });
          line.push(...(c[row] ?? [{ text: " ".repeat(cellWidth) }]));
        });
        lines.push(line);
      }
    }
  }
  lines.push(
    [],
    ...wordWrap(
      `Esc cancels. ${prefixLabel} twice sends ${prefixLabel} itself to the program in this tab.`,
      inner
    ).map((text) => [{ text, tone: "dim" as const }])
  );
  return lines;
}

/**
 * The binding painted at panel-relative cell (`x`, `y`) of a `PrefixMenu`
 * showing `lines`: inside the border and one column of padding, segments sit
 * left to right exactly as rendered.
 */
export function prefixMenuBindingAt(
  lines: MenuSegment[][],
  height: number,
  x: number,
  y: number
): Binding | null {
  const line = y >= 1 && y < height - 1 ? lines[y - 1] : undefined;
  let column = 2;
  for (const segment of line ?? []) {
    const end = column + segment.text.length;
    if (x >= column && x < end) return segment.binding ?? null;
    column = end;
  }
  return null;
}

export function PrefixMenu({
  lines,
  width,
  height,
}: {
  lines: MenuSegment[][];
  width: number;
  height: number;
}): React.ReactElement {
  return (
    <Box
      flexDirection="column"
      width={width}
      height={height}
      borderStyle="round"
      borderColor="yellow"
      paddingX={1}
    >
      {lines.slice(0, Math.max(0, height - 2)).map((line, index) => (
        <Text key={index} wrap="truncate-end">
          {line.length === 0
            ? " "
            : line.map((segment, at) => (
                <Text
                  key={at}
                  bold={
                    segment.tone === "key" || segment.tone === "title" || segment.tone === "head"
                  }
                  color={
                    segment.tone === "key"
                      ? "yellow"
                      : segment.tone === "title" || segment.tone === "head"
                        ? "cyan"
                        : undefined
                  }
                  dimColor={segment.tone === "dim"}
                >
                  {segment.text}
                </Text>
              ))}
        </Text>
      ))}
    </Box>
  );
}

// ── help ─────────────────────────────────────────────────────────────────────

export function HelpOverlay(props: {
  prefixLabel: string;
  width: number;
  height: number;
  scroll: number;
  onContentHeight: (rows: number) => void;
}): React.ReactElement {
  const p = props.prefixLabel;
  // One column for "prefix key", wide enough for the longest entry ("prefix prefix").
  const keyColumn = `  ${p} ${p}`.length + 2;
  return (
    <Box
      flexDirection="column"
      width={props.width}
      height={props.height}
      borderStyle="round"
      borderColor="cyan"
      paddingX={1}
    >
      <Text bold color="cyan">
        Vibestudio terminal — keys
      </Text>
      <Scrollable
        height={Math.max(1, props.height - 4)}
        scroll={props.scroll}
        onContentHeight={props.onContentHeight}
      >
        <Text wrap="wrap">
          {`Every key goes to the session in the focused tab, except the prefix key ${p}. Press ${p}, then one of these:`}
        </Text>
        <Box height={1} />
        {PREFIX_BINDINGS.map((binding) => (
          <Text key={binding.key} wrap="truncate-end">
            <Text color="cyan">{`  ${p} ${binding.key}`.padEnd(keyColumn)}</Text>
            {binding.description}
          </Text>
        ))}
        <Text wrap="truncate-end">
          <Text color="cyan">{`  ${p} ${p}`.padEnd(keyColumn)}</Text>
          {`Send ${p} itself to the session`}
        </Text>
        <Box height={1} />
        <Text bold>Mouse</Text>
        <Text wrap="wrap">
          {
            "  Click a tab to switch to it. Scroll the wheel over a session to read its scrollback (unless the app uses the mouse itself). Hold Shift while dragging to select text in your terminal."
          }
        </Text>
        <Box height={1} />
        <Text bold>Copy mode ({`${p} [`})</Text>
        <Text wrap="wrap">
          {
            "  ↑↓←→ / hjkl move · PgUp/PgDn page · g/G top/bottom · / search · n/N next/previous match · v or Space select · y or Enter copy (OSC 52) · q or Ctrl-G leave"
          }
        </Text>
        <Box height={1} />
        <Text bold>Links ({`${p} o`})</Text>
        <Text wrap="wrap">
          {
            "  Programs can mark links (OSC 8). Click one, or list the tab's links. Nothing opens until you confirm with o; only http and https links open, in your browser on this computer."
          }
        </Text>
        <Box height={1} />
        <Text bold>Sessions</Text>
        <Text wrap="wrap">
          {`  Every tab is a program running in the workspace. Detaching (${p} d) or quitting (${p} q) leaves it running: resume it from the launcher (${p} c) on this or another device. Ending it (${p} x) stops it for good.`}
        </Text>
        <Box height={1} />
        <Text bold>Approvals and protected input</Text>
        <Text wrap="wrap">
          ↑↓ chooses a request; removing it never transfers your consent to another. Digits choose
          offered decisions. Forms use Tab/Shift-Tab fields, Enter next/submit, ←→ choices and
          Ctrl-D decline. Ctrl-G dismisses without deciding; entered secrets are cleared and never
          forwarded to a tab.
        </Text>
        <Box height={1} />
        <Text bold>Logs, files and exports</Text>
        <Text wrap="wrap">{`${p} l opens the log; / filters entries, Enter inspects full text, c copies and e exports. The palette (${p} k) offers terminal-output export and session-context upload/download. File gestures ask for exact paths and explicit confirmation, keeping the original target if you switch tabs. Uploads replace the selected workspace destination; downloads and text exports never overwrite local files. Uploaded workspace paths can be used with /attach in chat.`}</Text>
        <Box height={1} />
        <Text bold>Terminal apps</Text>
        <Text wrap="wrap">
          {
            "  A terminal app is a program in the workspace's terminal-apps/<name> folder: a panel hosted by terminals. It appears under Start in the launcher once built. Shell opens your login shell in the workspace."
          }
        </Text>
      </Scrollable>
      <Text dimColor>
        Ctrl-G always cancels browser UI; Escape also works on enhanced-keyboard terminals.
        ↑↓/PgUp/PgDn scroll
      </Text>
    </Box>
  );
}

// ── logs ─────────────────────────────────────────────────────────────────────

export interface LogLine {
  time: number;
  level: "info" | "warn" | "error";
  message: string;
}

export function LogsOverlay(props: {
  lines: readonly LogLine[];
  width: number;
  height: number;
  /** Lines scrolled up from the newest. */
  scroll: number;
  logFile?: string;
}): React.ReactElement {
  const rows = Math.max(1, props.height - 4);
  const end = Math.max(0, props.lines.length - props.scroll);
  const shown = props.lines.slice(Math.max(0, end - rows), end);
  return (
    <Box
      flexDirection="column"
      width={props.width}
      height={props.height}
      borderStyle="round"
      borderColor="cyan"
      paddingX={1}
    >
      <Text bold color="cyan" wrap="truncate-end">
        {`Browser log${props.logFile ? ` · server log: ${props.logFile}` : ""}`}
      </Text>
      <Box flexDirection="column" height={rows}>
        {shown.length === 0 ? (
          <Text dimColor>Nothing logged yet.</Text>
        ) : (
          shown.map((line, index) => (
            <Text
              key={index}
              color={line.level === "error" ? "red" : line.level === "warn" ? "yellow" : undefined}
              wrap="truncate-end"
            >
              {`${new Date(line.time).toTimeString().slice(0, 8)} ${line.message}`}
            </Text>
          ))
        )}
      </Box>
      <Text dimColor>
        {props.scroll > 0 ? `${props.scroll} lines up · ` : ""}↑↓/PgUp/PgDn scroll · / search ·
        Enter full detail · c copy · e export · Ctrl-G close
      </Text>
    </Box>
  );
}

// ── settings ─────────────────────────────────────────────────────────────────

/** Rows above the first setting: border, title, explanation and a gap. */
const SETTINGS_TOP = 4;

function settingValueText(row: (typeof SETTING_ROWS)[number], settings: BrowserSettings): string {
  return `‹ ${row.value(settings)} ›`;
}

/**
 * What a click at overlay-relative (`x`, `y`) of a `SettingsOverlay` means:
 * the setting on that row, and on its ‹ value › a step like ← or →.
 */
export function settingsAt(
  settings: BrowserSettings,
  width: number,
  x: number,
  y: number
): { index: number; step: -1 | 0 | 1 } | null {
  const index = y - SETTINGS_TOP;
  const row = SETTING_ROWS[index];
  if (!row) return null;
  // Right-aligned inside the border and one column of padding.
  const end = width - 2;
  const start = end - settingValueText(row, settings).length;
  if (x < start || x >= end) return { index, step: 0 };
  return { index, step: x - start < 2 ? -1 : 1 };
}

export function SettingsOverlay(props: {
  settings: BrowserSettings;
  selected: number;
  width: number;
  height: number;
  error?: string | null;
  loading?: boolean;
}): React.ReactElement {
  const current = SETTING_ROWS[props.selected];
  return (
    <Box
      flexDirection="column"
      width={props.width}
      height={props.height}
      borderStyle="round"
      borderColor="cyan"
      paddingX={1}
    >
      <Text bold color="cyan">
        Settings
      </Text>
      <Text dimColor wrap="truncate-end">
        {props.loading
          ? "Loading your saved settings before editing…"
          : "Saved for you on the server, so they follow you to other devices."}
      </Text>
      <Box height={1} />
      {SETTING_ROWS.map((row, index) => (
        <Box key={row.key} justifyContent="space-between">
          <Text
            inverse={index === props.selected}
          >{`${index === props.selected ? "▸ " : "  "}${row.label}`}</Text>
          <Text color="cyan">{settingValueText(row, props.settings)}</Text>
        </Box>
      ))}
      <Box height={1} />
      {current ? <Text wrap="wrap">{current.explain}</Text> : null}
      {props.error ? (
        <Text color="red" wrap="wrap">
          {props.error}
        </Text>
      ) : null}
      <Box flexGrow={1} />
      <Text dimColor>↑↓ choose · ←→ or click ‹ › change · Esc close</Text>
    </Box>
  );
}

// ── links ────────────────────────────────────────────────────────────────────

/** The URL with its host emphasised, so a lookalike domain is easy to spot. */
function UrlLine({ url }: { url: string }): React.ReactElement {
  let parsed: URL | null = null;
  try {
    parsed = new URL(url);
  } catch {
    parsed = null;
  }
  if (!parsed) return <Text wrap="wrap">{url}</Text>;
  const host = parsed.host;
  const index = url.indexOf(host);
  return (
    <Text wrap="wrap">
      {url.slice(0, index)}
      <Text bold underline>
        {host}
      </Text>
      {url.slice(index + host.length)}
    </Text>
  );
}

export function OpenUrlDialog(props: {
  sessionTitle: string;
  url: string;
  allowed: boolean;
  width: number;
  height: number;
}): React.ReactElement {
  let host = "";
  try {
    host = new URL(props.url).host;
  } catch {
    host = "";
  }
  return (
    <Box
      flexDirection="column"
      width={props.width}
      height={props.height}
      borderStyle="double"
      borderColor="yellow"
      paddingX={1}
    >
      <Text bold color="yellow">{`Open a link from ${props.sessionTitle}?`}</Text>
      <Box height={1} />
      <UrlLine url={props.url} />
      {host ? <Text dimColor>{`Site: ${host}`}</Text> : null}
      <Box height={1} />
      {props.allowed ? (
        <Text wrap="wrap">
          It opens in your browser on this computer. Only open links you expect.
        </Text>
      ) : (
        <Text color="red" wrap="wrap">
          Only http and https links can be opened from the terminal.
        </Text>
      )}
      <Box flexGrow={1} />
      <ButtonRow
        buttons={[
          ...(props.allowed
            ? [
                {
                  id: "open",
                  label: "[o] Open",
                  action: { key: "o", confirm: true },
                  color: "green" as const,
                },
              ]
            : []),
          {
            id: "cancel",
            label: "[Esc] Cancel",
            action: { key: "escape" },
            color: "red" as const,
          },
        ]}
      />
    </Box>
  );
}

// ── messages in the session area ─────────────────────────────────────────────

export function MessageBox(props: {
  title: string;
  lines: string[];
  tone: "info" | "warn" | "error";
  width: number;
  height: number;
  /** The choices, as buttons for their keys. */
  buttons?: readonly Button[];
}): React.ReactElement {
  const color = props.tone === "error" ? "red" : props.tone === "warn" ? "yellow" : "cyan";
  return (
    <Box
      flexDirection="column"
      width={props.width}
      height={props.height}
      borderStyle="round"
      borderColor={color}
      paddingX={1}
    >
      <Text bold color={color} wrap="truncate-end">
        {props.title}
      </Text>
      {props.lines.map((line, index) => (
        <Text key={index} wrap="wrap">
          {line}
        </Text>
      ))}
      {props.buttons ? <ButtonRow buttons={props.buttons} /> : null}
    </Box>
  );
}
