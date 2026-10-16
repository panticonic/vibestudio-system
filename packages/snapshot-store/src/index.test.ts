import { describe, expect, it, vi } from "vitest";
import { createSnapshotStore } from "./index.js";

describe("snapshot store", () => {
  it("notifies subscribers once per distinct snapshot and stops after unsubscribe", () => {
    const store = createSnapshotStore({ n: 0 });
    const listener = vi.fn();
    const stop = store.subscribe(listener);
    const same = store.getSnapshot();
    store.set(same);
    expect(listener).not.toHaveBeenCalled();
    store.update((current) => ({ n: current.n + 1 }));
    expect(store.getSnapshot()).toEqual({ n: 1 });
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
    store.set({ n: 2 });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
