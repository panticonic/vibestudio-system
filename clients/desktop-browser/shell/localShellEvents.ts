import type { EventName, EventPayloads } from "./workspaceClient";

type Listener = (payload: unknown) => void;

/**
 * Shell events this client raises for itself (a menu choice, a chord the host
 * relayed). They reach the same `useShellEvent` listeners as events the host
 * and server deliver, so a command has one handler wherever it came from.
 */
const listeners = new Map<EventName, Set<Listener>>();

export const localShellEvents = {
  on<E extends EventName>(event: E, listener: (payload: EventPayloads[E]) => void): () => void {
    let set = listeners.get(event);
    if (!set) {
      set = new Set();
      listeners.set(event, set);
    }
    set.add(listener as Listener);
    return () => {
      set.delete(listener as Listener);
      if (set.size === 0) listeners.delete(event);
    };
  },
  emit<E extends EventName>(
    event: E,
    ...payload: EventPayloads[E] extends undefined | void ? [] : [EventPayloads[E]]
  ): void {
    for (const listener of [...(listeners.get(event) ?? [])]) listener(payload[0]);
  },
};
