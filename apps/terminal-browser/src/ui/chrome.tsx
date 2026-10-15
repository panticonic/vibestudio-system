import React from "react";
import { Box, Text } from "ink";
import type { FuzzyMatch } from "../input/fuzzy.js";
import { PREFIX_BINDINGS } from "../input/keymap.js";
import { SETTING_ROWS, type BrowserSettings } from "../settings.js";
import { Scrollable } from "./Scrollable.js";

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
  approvals: number;
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
    return (
      <Box width={width} height={1}>
        <Text backgroundColor="yellow" color="black" wrap="truncate-end">
          {` ${view.prefixLabel} › k palette · c new · 1-9 tabs · n/p next/prev · [ copy · o links · a approvals · d detach · ? help · q quit · Esc cancel `.padEnd(
            width
          )}
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
  const right = view.hint ?? `${view.prefixLabel} ? help`;
  return (
    <Box width={width} height={1} justifyContent="space-between">
      <Box flexShrink={1} flexGrow={1}>
        <Text wrap="truncate-end">
          {/* Most important first: truncation cuts the server address, never approvals. */}
          {view.approvals > 0 ? (
            <Text color="black" backgroundColor="yellow" bold>
              {` ${view.approvals} approval${view.approvals === 1 ? "" : "s"} · ${view.prefixLabel} a `}
            </Text>
          ) : null}
          {view.notice ? <Text color="cyan">{` ${view.notice} ·`}</Text> : null}
          <Text bold>{` ${view.workspace}`}</Text>
          <Text dimColor>{" · "}</Text>
          <Text color={connection.color}>{connection.text}</Text>
          <Text dimColor>{` · ${view.server}`}</Text>
        </Text>
      </Box>
      <Box flexShrink={0}>
        <Text dimColor wrap="truncate-start">{`${right} `}</Text>
      </Box>
    </Box>
  );
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

export function ListOverlay(props: ListOverlayProps): React.ReactElement {
  const { items, selected, width, height } = props;
  const inner = Math.max(1, height - (props.border === false ? 0 : 2));
  const rowsPerItem = items.some((item) => item.detail) ? 2 : 1;
  const sections = new Set(items.map((item) => item.section).filter(Boolean)).size;
  const listRows = Math.max(1, inner - 3 - (props.query || items.length ? 0 : 0));
  const capacity = Math.max(1, Math.floor((listRows - Math.min(sections, 2)) / rowsPerItem));
  const first = Math.min(
    Math.max(0, selected - Math.floor(capacity / 2)),
    Math.max(0, items.length - capacity)
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
      <Text dimColor>
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
          <Text color="cyan">{`‹ ${row.value(props.settings)} ›`}</Text>
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
      <Text dimColor>↑↓ choose · ←→ change · Esc close</Text>
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
      <Text>
        {props.allowed ? (
          <>
            <Text color="green" bold>
              o
            </Text>
            {" open   "}
          </>
        ) : null}
        <Text color="red" bold>
          Esc
        </Text>
        {" cancel"}
      </Text>
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
    </Box>
  );
}
