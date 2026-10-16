import type { PanelEntityId } from "@vibestudio/shared/panel/ids";
import { createFakeClientHost } from "@workspace/client-kit-native/testing";
import { MobileRpcClient } from "./mobileTransport";

/**
 * The client API is the real one over an in-memory host: a workspace session
 * opened through the account carries panel sessions as auxiliary sessions on
 * the same connection.
 */
describe("panel sessions over the host connection", () => {
  it("opens a panel session as an auxiliary session of the workspace session", async () => {
    const fake = await createFakeClientHost();
    const account = await fake.api.session.openAccount();
    const client = new MobileRpcClient({
      connectWorkspace: (onRecovery) => account.openWorkspace("ws-a", onRecovery),
    });
    try {
      const session = await client.openPanelSession("panel:runtime-1" as PanelEntityId, "panel-conn-1");

      const [workspaceOpen] = fake.callsOf("session.openWorkspace");
      const [auxiliaryOpen] = fake.callsOf("session.openAuxiliary");
      expect(workspaceOpen?.[1]).toBe("ws-a");
      expect(auxiliaryOpen?.[1]).toEqual({
        parentSessionId: workspaceOpen?.[0],
        label: "panel panel:runtime-1",
        connectionId: "panel-conn-1",
      });
      expect(session.sessionId).toBe(auxiliaryOpen?.[0]);
      expect(fake.callsOf("session.ready").map(([id]) => id)).toContain(session.sessionId);
      expect(session.isClosed()).toBe(false);
    } finally {
      await client.close();
    }
  });

  it("answers the host's token request with a fresh grant from the workspace session", async () => {
    const fake = await createFakeClientHost({
      handlers: {
        "session.postEnvelope": () => undefined,
      },
    });
    const account = await fake.api.session.openAccount();
    const connection = await account.openWorkspace("ws-a");
    const tokens = ["grant-1", "grant-2"];
    const session = connection.transport.openSession({
      label: "panel",
      getToken: () => tokens.shift()!,
    });
    await session.authenticated();

    fake.emit({ type: "session-token-request", sessionId: session.sessionId });
    fake.emit({ type: "session-token-request", sessionId: session.sessionId });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(
      fake.callsOf("session.provideToken").map(([, outcome]) => outcome),
    ).toEqual([{ token: "grant-1" }, { token: "grant-2" }]);
    await account.close();
  });

  it("ends the panel session when the host reports it closed", async () => {
    const fake = await createFakeClientHost();
    const account = await fake.api.session.openAccount();
    const connection = await account.openWorkspace("ws-a");
    const session = connection.transport.openSession({ label: "panel", getToken: () => "t" });
    await session.authenticated();
    const closed = jest.fn();
    session.onClosed(closed);

    fake.emit({
      type: "session-closed",
      sessionId: session.sessionId,
      reason: "trust-revoked",
      message: "withdrawn",
    });

    expect(closed).toHaveBeenCalledWith({ reason: "trust-revoked", message: "withdrawn" });
    expect(session.isClosed()).toBe(true);
    await expect(
      session.send({} as never),
    ).rejects.toThrow("Session is closed: withdrawn");
    await account.close();
  });
});
