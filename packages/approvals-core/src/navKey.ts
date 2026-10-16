/**
 * The key vocabulary the approval navigation reducers understand. It is a
 * neutral description of "which key was pressed", not a terminal type: any kit
 * with a keyboard maps its own events onto it (the terminal tokenizer's
 * `NavKey` is exactly this union).
 */
export type ApprovalNavKey =
  | "up"
  | "down"
  | "left"
  | "right"
  | "tab"
  | "enter"
  | "escape"
  | "pageup"
  | "pagedown"
  | "home"
  | "end"
  | "backspace"
  | { digit: number }
  | { char: string }
  | null;
