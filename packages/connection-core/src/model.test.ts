import { describe, expect, it, vi } from "vitest";
import type { WorkspaceConnectionState } from "@vibestudio/shared/workspaceConnection";
import { createConnectionModel, type ConnectionPort } from "./model.js";
import { createOutageGate } from "./outageGate.js";

const state = (phase: WorkspaceConnectionState["phase"]): WorkspaceConnectionState => ({
  version: 1,
  phase,
  mode: "local",
  since: 1,
});

function fakePort(initial: WorkspaceConnectionState) {
  let handler: ((state: WorkspaceConnectionState) => void) | null = null;
  const port: ConnectionPort = {
    current: async () => initial,
    onChange: (next) => {
      handler = next;
      return () => {
        handler = null;
      };
    },
    reconnectNow: vi.fn(async () => undefined),
    relaunch: vi.fn(async () => undefined),
  };
  return { port, emit: (next: WorkspaceConnectionState) => handler?.(next), attached: () => handler !== null };
}

describe("connection model", () => {
  it("prefers a pushed change over the older first read", async () => {
    const { port, emit } = fakePort(state("online"));
    const model = createConnectionModel(port);
    model.start();
    emit(state("reconnecting"));
    await Promise.resolve();
    await Promise.resolve();
    expect(model.getSnapshot().state?.phase).toBe("reconnecting");
  });

  it("retries while reconnecting and relaunches once the session ended", async () => {
    const { port, emit } = fakePort(state("online"));
    const model = createConnectionModel(port);
    const stop = model.start();
    emit(state("reconnecting"));
    await model.recover();
    expect(port.reconnectNow).toHaveBeenCalledTimes(1);
    emit(state("ended"));
    await model.recover();
    expect(port.relaunch).toHaveBeenCalledTimes(1);
    stop();
  });

  it("keeps the recovery failure and rethrows it to the caller", async () => {
    const { port, emit } = fakePort(state("online"));
    vi.mocked(port.reconnectNow).mockRejectedValueOnce(new Error("no route"));
    const model = createConnectionModel(port);
    model.start();
    emit(state("reconnecting"));
    await expect(model.recover()).rejects.toThrow("no route");
    expect(model.getSnapshot()).toMatchObject({ recovering: false });
    expect(String(model.getSnapshot().recoveryError)).toContain("no route");
  });

  it("stops listening when retired", () => {
    const fake = fakePort(state("online"));
    const stop = createConnectionModel(fake.port).start();
    stop();
    expect(fake.attached()).toBe(false);
  });
});

describe("outage gate", () => {
  function gate() {
    const scheduled: Array<() => void> = [];
    const seen: boolean[] = [];
    const g = createOutageGate(
      (visible) => seen.push(visible),
      350,
      {
        set: (callback) => {
          scheduled.push(callback);
          return scheduled.length - 1;
        },
        clear: (handle) => {
          scheduled[handle as number] = () => undefined;
        },
      }
    );
    return { g, scheduled, seen };
  }

  it("does not flash a banner for an outage that heals before the delay", () => {
    const { g, scheduled, seen } = gate();
    g.phase("reconnecting");
    g.phase("online");
    scheduled.forEach((run) => run());
    expect(seen).toEqual([]);
  });

  it("shows a lasting outage after the delay and an ended session at once", () => {
    const { g, scheduled, seen } = gate();
    g.phase("reconnecting");
    scheduled[0]!();
    expect(seen).toEqual([true]);
    g.phase("online");
    g.phase("ended");
    expect(seen).toEqual([true, false, true]);
  });
});
