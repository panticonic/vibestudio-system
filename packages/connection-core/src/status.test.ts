import { describe, expect, it } from "vitest";
import {
  connectionNotice,
  connectionSentence,
  connectionStatusLine,
  viewFromTerminalConnection,
  viewFromTransport,
  viewFromWorkspaceConnection,
} from "./status.js";
import { createConnectionTracker } from "./tracker.js";

describe("connection status line", () => {
  it("never lets a device no-internet signal override a live pipe", () => {
    const view = viewFromTransport({ status: "connected", everOnline: false, networkReachable: false });
    expect(connectionStatusLine(view)).toEqual({ tone: "ok", label: "Connected" });
  });

  it("says no network only when there is no link and the pipe is not up", () => {
    expect(
      connectionStatusLine(
        viewFromTransport({ status: "disconnected", everOnline: true, networkReachable: false })
      ).label
    ).toBe("No network");
    expect(
      connectionStatusLine(viewFromTransport({ status: "disconnected", everOnline: true })).label
    ).toBe("Disconnected");
  });

  it("tells connecting from reconnecting by whether the connection was ever up", () => {
    expect(connectionStatusLine(viewFromTransport({ status: "connecting", everOnline: false })).label).toBe(
      "Connecting…"
    );
    expect(connectionStatusLine(viewFromTransport({ status: "connecting", everOnline: true })).label).toBe(
      "Reconnecting…"
    );
  });

  it("maps the terminal host's states onto the same lines", () => {
    expect(connectionStatusLine(viewFromTerminalConnection({ phase: "connected" })).tone).toBe("ok");
    expect(
      connectionStatusLine(viewFromTerminalConnection({ phase: "reconnecting", cause: "socket closed" }))
    ).toEqual({ tone: "pending", label: "Reconnecting…", detail: "socket closed" });
    expect(
      connectionStatusLine(viewFromTerminalConnection({ phase: "lost", cause: "server gone" }))
    ).toEqual({ tone: "problem", label: "Disconnected", detail: "server gone" });
  });

  it("keeps the terminal's wording when the host gives no cause", () => {
    expect(connectionStatusLine(viewFromTerminalConnection({ phase: "reconnecting" })).detail).toBe(
      "connection interrupted"
    );
    expect(connectionStatusLine(viewFromTerminalConnection({ phase: "lost" })).detail).toBe("server gone");
    expect(connectionStatusLine(viewFromTerminalConnection({ phase: "connected" })).detail).toBeUndefined();
  });

  it("describes the server connection in one sentence", () => {
    const base = { since: 1, version: 1 as const, mode: "local" as const };
    expect(
      connectionSentence({
        view: viewFromWorkspaceConnection({ ...base, phase: "reconnecting", attempt: 3 }),
        isRemote: false,
      })
    ).toBe("Reconnecting to server (attempt 3)…");
    expect(
      connectionSentence({
        view: viewFromWorkspaceConnection({ ...base, phase: "online" }),
        isRemote: true,
        remoteHost: "box.example",
      })
    ).toBe("Connected to box.example");
    expect(
      connectionSentence({
        view: viewFromWorkspaceConnection({ ...base, phase: "ended" }),
        isRemote: true,
        remoteHost: "box.example",
      })
    ).toBe("Disconnected from remote server box.example");
  });

  it("marks only an ended session as final, and shows nothing while healthy", () => {
    const base = { since: 1, version: 1 as const, mode: "local" as const };
    expect(connectionNotice({ ...base, phase: "online" })).toBeNull();
    expect(connectionNotice({ ...base, phase: "reconnecting" })?.final).toBe(false);
    expect(connectionNotice({ ...base, phase: "ended" })?.final).toBe(true);
  });
});

describe("connection tracker", () => {
  it("remembers that the connection was up and resets attempts when it returns", () => {
    const tracker = createConnectionTracker();
    expect(tracker.getSnapshot().phase).toBe("starting");
    tracker.transport("connected");
    expect(tracker.getSnapshot().phase).toBe("online");
    tracker.transport("connecting");
    tracker.reconnectProgress({ attempt: 2 });
    expect(tracker.getSnapshot()).toMatchObject({ phase: "reconnecting", attempt: 2, everOnline: true });
    tracker.transport("connected");
    expect(tracker.getSnapshot().attempt).toBeUndefined();
  });

  it("notifies subscribers of a reachability change while down", () => {
    const tracker = createConnectionTracker();
    let calls = 0;
    tracker.subscribe(() => calls++);
    tracker.transport("disconnected");
    tracker.networkReachable(false);
    expect(calls).toBe(2);
    expect(connectionStatusLine(tracker.getSnapshot()).label).toBe("No network");
  });
});
