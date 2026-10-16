/**
 * A snapshot cell: `getSnapshot` returns the current immutable value, `subscribe`
 * is told after every change. The two methods have exactly the shape React's
 * `useSyncExternalStore` takes, and any other runtime (Ink, tests) can read the
 * same cell, so each headless core is observed the same way everywhere.
 */
export interface SnapshotStore<T> {
  getSnapshot(): T;
  subscribe(listener: () => void): () => void;
}

export interface WritableSnapshotStore<T> extends SnapshotStore<T> {
  /** Replace the snapshot. Listeners run only when the value is not the same reference. */
  set(next: T): void;
  /** Replace the snapshot with a function of the current one. */
  update(next: (current: T) => T): void;
}

export function createSnapshotStore<T>(initial: T): WritableSnapshotStore<T> {
  let current = initial;
  const listeners = new Set<() => void>();
  const store: WritableSnapshotStore<T> = {
    getSnapshot: () => current,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set(next) {
      if (Object.is(next, current)) return;
      current = next;
      for (const listener of [...listeners]) listener();
    },
    update(next) {
      store.set(next(current));
    },
  };
  return store;
}
