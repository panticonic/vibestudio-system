import {
  DEFAULT_PREFIX_KEY,
  PREFIX_KEYS,
  isPrefixKeyId,
  prefixLabel,
  type PrefixKeyId,
} from "./input/keymap.js";

/** Terminal browser preferences, stored per person by the System workspace's terminal launch service (they follow you across devices). */
export interface BrowserSettings {
  prefixKey: PrefixKeyId;
  /** Open the approvals overlay by itself when the focused session asks for approval. */
  autoOpenApprovals: boolean;
  /** Ring the terminal bell when an unfocused session asks for attention. */
  bell: boolean;
  /** Use the mouse for tabs and scrolling (hold Shift to select text natively). */
  mouse: boolean;
}

export const DEFAULT_SETTINGS: BrowserSettings = {
  prefixKey: DEFAULT_PREFIX_KEY,
  autoOpenApprovals: true,
  bell: false,
  mouse: true,
};

/** Read stored settings; unknown or invalid fields fall back to their defaults. */
export function parseSettings(raw: Record<string, unknown>): BrowserSettings {
  return {
    prefixKey: isPrefixKeyId(raw["prefixKey"]) ? raw["prefixKey"] : DEFAULT_SETTINGS.prefixKey,
    autoOpenApprovals:
      typeof raw["autoOpenApprovals"] === "boolean"
        ? raw["autoOpenApprovals"]
        : DEFAULT_SETTINGS.autoOpenApprovals,
    bell: typeof raw["bell"] === "boolean" ? raw["bell"] : DEFAULT_SETTINGS.bell,
    mouse: typeof raw["mouse"] === "boolean" ? raw["mouse"] : DEFAULT_SETTINGS.mouse,
  };
}

export interface SettingRow {
  key: keyof BrowserSettings;
  label: string;
  value(settings: BrowserSettings): string;
  explain: string;
  /** The setting after one step left (-1) or right (+1). */
  step(settings: BrowserSettings, direction: 1 | -1): BrowserSettings;
}

const toggle = (key: "autoOpenApprovals" | "bell" | "mouse") => (settings: BrowserSettings) => ({
  ...settings,
  [key]: !settings[key],
});

export const SETTING_ROWS: readonly SettingRow[] = [
  {
    key: "prefixKey",
    label: "Prefix key",
    value: (s) => prefixLabel(s.prefixKey),
    explain: "Press it, then a command key. Every other key goes to the session.",
    step: (s, direction) => {
      const index = PREFIX_KEYS.findIndex((key) => key.id === s.prefixKey);
      const next = PREFIX_KEYS[(index + direction + PREFIX_KEYS.length) % PREFIX_KEYS.length]!;
      return { ...s, prefixKey: next.id };
    },
  },
  {
    key: "autoOpenApprovals",
    label: "Open approvals automatically",
    value: (s) => (s.autoOpenApprovals ? "on" : "off"),
    explain:
      "Show each new approval in full as it arrives; click to answer, or press the prefix then a for keys.",
    step: toggle("autoOpenApprovals"),
  },
  {
    key: "bell",
    label: "Bell",
    value: (s) => (s.bell ? "on" : "off"),
    explain: "Ring the terminal bell when a background tab wants your attention.",
    step: toggle("bell"),
  },
  {
    key: "mouse",
    label: "Mouse",
    value: (s) => (s.mouse ? "on" : "off"),
    explain: "Click tabs and scroll with the wheel. Hold Shift to select text in your terminal.",
    step: toggle("mouse"),
  },
];
