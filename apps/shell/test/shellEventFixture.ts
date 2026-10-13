import { useEffect, useLayoutEffect, useRef } from "react";

export type ShellEventFixtureListener = (payload: unknown) => void;
export type ShellEventFixtureListeners = Map<
  string,
  Set<ShellEventFixtureListener>
>;

export function useShellEventFixture(
  listeners: ShellEventFixtureListeners,
  event: string,
  callback: ShellEventFixtureListener,
  readSnapshot?: (signal: AbortSignal) => void | Promise<void>,
): void {
  const callbackRef = useRef(callback);
  useLayoutEffect(() => {
    callbackRef.current = callback;
  });
  useEffect(() => {
    const lifetime = new AbortController();
    const listener: ShellEventFixtureListener = (payload) =>
      callbackRef.current(payload);
    const topic = listeners.get(event) ?? new Set<ShellEventFixtureListener>();
    topic.add(listener);
    listeners.set(event, topic);
    void Promise.resolve()
      .then(() => readSnapshot?.(lifetime.signal))
      .catch((error: unknown) => {
        if (!lifetime.signal.aborted)
          console.warn(`[useShellEvent fixture] watch ${event} failed:`, error);
      });
    return () => {
      lifetime.abort();
      topic.delete(listener);
      if (topic.size === 0 && listeners.get(event) === topic)
        listeners.delete(event);
    };
  }, [event, listeners, readSnapshot]);
}

export function emitShellEventFixture(
  listeners: ShellEventFixtureListeners,
  event: string,
  payload?: unknown,
): void {
  for (const listener of [...(listeners.get(event) ?? [])]) listener(payload);
}
