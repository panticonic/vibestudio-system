import { describe, expect, it, vi } from "vitest";

const draftSelectedProblem = vi.hoisted(() => vi.fn());
vi.mock("@workspace/runtime/problem-reports", () => ({ draftSelectedProblem }));

import { createChatProblemReports } from "./problemReports";

const selection = {
  problem: { kind: "message", summary: "wrong answer" } as never,
  source: "chat-message" as never,
  coordinate: { messageId: "m1" },
  value: { text: "hello" },
};

describe("chat problem reports", () => {
  it("drafts the selected message under this client's coordinate and opens the reporting chat", async () => {
    draftSelectedProblem.mockResolvedValue({ reportId: "r1", revision: 2 });
    const startConversation = vi.fn();
    const port = createChatProblemReports({
      rpc: { call: vi.fn() } as never,
      clientId: "client:chat:web:dev-1",
      startConversation,
    });

    await port.report(selection);

    const coordinate = JSON.stringify({ clientId: "client:chat:web:dev-1", messageId: "m1" });
    expect(draftSelectedProblem).toHaveBeenCalledWith(expect.anything(), {
      problem: selection.problem,
      source: selection.source,
      coordinate,
      value: selection.value,
      reference: { kind: "message", coordinate },
    });
    expect(startConversation).toHaveBeenCalledWith(expect.stringContaining("saved draft r1, revision 2"));
  });

  it("reports a failed draft to the caller and opens nothing", async () => {
    draftSelectedProblem.mockRejectedValue(new Error("not allowed"));
    const startConversation = vi.fn();
    const port = createChatProblemReports({ rpc: {} as never, clientId: "c", startConversation });
    await expect(port.report(selection)).rejects.toThrow("not allowed");
    expect(startConversation).not.toHaveBeenCalled();
  });
});
