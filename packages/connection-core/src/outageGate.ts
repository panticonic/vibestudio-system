import type { ConnectionPhase } from "./status.js";

/**
 * Whether an availability notice should be on screen yet.
 *
 * A blip that heals within `delayMs` should never flash a banner, so a
 * reconnecting phase only becomes visible after the delay, while a final
 * `ended` phase shows at once and any healthy phase hides at once. This is a
 * presentation debounce, not a lifecycle deadline: nothing is cancelled or
 * settled by it, and the underlying reconnect runs regardless.
 */
export const TRANSIENT_OUTAGE_DELAY_MS = 350;

export interface OutageGate {
  /** Tell the gate the phase; `onVisible` is told whenever visibility changes. */
  phase(phase: ConnectionPhase): void;
  readonly visible: boolean;
  dispose(): void;
}

export function createOutageGate(
  onVisible: (visible: boolean) => void,
  delayMs: number = TRANSIENT_OUTAGE_DELAY_MS,
  timers: {
    set(callback: () => void, ms: number): unknown;
    clear(handle: unknown): void;
  } = {
    set: (callback, ms) => setTimeout(callback, ms),
    clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  }
): OutageGate {
  let visible = false;
  let pending: unknown = undefined;
  const show = (next: boolean) => {
    if (visible === next) return;
    visible = next;
    onVisible(next);
  };
  const cancel = () => {
    if (pending === undefined) return;
    timers.clear(pending);
    pending = undefined;
  };
  return {
    phase(phase) {
      if (phase === "ended") {
        cancel();
        show(true);
      } else if (phase !== "reconnecting") {
        cancel();
        show(false);
      } else if (!visible && pending === undefined) {
        pending = timers.set(() => {
          pending = undefined;
          show(true);
        }, delayMs);
      }
    },
    get visible() {
      return visible;
    },
    dispose: cancel,
  };
}
