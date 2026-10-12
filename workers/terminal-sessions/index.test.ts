import { describe, expect, it } from "vitest";
import { createTestDO } from "@workspace/runtime/worker/test-utils";
import { TerminalSessionsDO } from "./index.js";

const alice = { callerId: "app:terminal", callerKind: "app" as const, userId: "alice" };
const bob = { callerId: "app:terminal", callerKind: "app" as const, userId: "bob" };

const session = (sessionId: string, title = "Activity") => ({
  sessionId,
  source: "workers/terminal-activity",
  className: "TerminalActivitySession",
  title,
  contextId: `ctx-${sessionId}`,
});

describe("TerminalSessionsDO", () => {
  it("records, lists most-recent-first, renames and forgets a person's sessions", async () => {
    const { callAs } = await createTestDO(TerminalSessionsDO);
    await callAs(alice, "recordSession", session("s1"));
    await new Promise((resolve) => setTimeout(resolve, 2));
    await callAs(alice, "recordSession", session("s2", "Logs"));
    let rows = (await callAs(alice, "listSessions")) as Array<{
      sessionId: string;
      title?: string;
    }>;
    expect(rows.map((r) => r.sessionId)).toEqual(["s2", "s1"]);

    await new Promise((resolve) => setTimeout(resolve, 2));
    await callAs(alice, "markAttached", "s1");
    await callAs(alice, "setSessionTitle", "s1", "Build\x1b[31m log");
    rows = (await callAs(alice, "listSessions")) as Array<{ sessionId: string; title: string }>;
    expect(rows[0]).toMatchObject({
      sessionId: "s1",
      title: "Build [31m log",
      contextId: "ctx-s1",
    });

    await callAs(alice, "forgetSession", "s1");
    rows = (await callAs(alice, "listSessions")) as Array<{ sessionId: string; title?: string }>;
    expect(rows.map((r) => r.sessionId)).toEqual(["s2"]);
  });

  it("partitions sessions and settings by person", async () => {
    const { callAs } = await createTestDO(TerminalSessionsDO);
    await callAs(alice, "recordSession", session("s1"));
    await callAs(alice, "setSettings", { prefixKey: "C-a" });
    expect(await callAs(bob, "listSessions")).toEqual([]);
    expect(await callAs(bob, "getSettings")).toEqual({});
    await expect(callAs(bob, "markAttached", "s1")).rejects.toThrow(/Unknown terminal session/);
    await expect(callAs(bob, "setSessionTitle", "s1", "mine")).rejects.toThrow(/Unknown/);
    expect(await callAs(alice, "getSettings")).toEqual({ prefixKey: "C-a" });
  });

  it("keeps a session's identity immutable", async () => {
    const { callAs } = await createTestDO(TerminalSessionsDO);
    await callAs(alice, "recordSession", session("s1"));
    await expect(
      callAs(alice, "recordSession", { ...session("s1"), contextId: "ctx-other" })
    ).rejects.toThrow(/different app or context/);
  });

  it("rejects oversized or malformed settings", async () => {
    const { callAs } = await createTestDO(TerminalSessionsDO);
    await expect(callAs(alice, "setSettings", { blob: "x".repeat(5000) })).rejects.toThrow(
      /exceed/
    );
    await expect(callAs(alice, "setSettings", ["no"])).rejects.toThrow(/object/);
  });
});
