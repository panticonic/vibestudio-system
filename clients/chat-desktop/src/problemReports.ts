import { draftSelectedProblem } from "@workspace/runtime/problem-reports";
import { problemReportingConversation } from "@vibestudio/shared/problemReportingConversation";
import type { RpcCaller } from "@vibestudio/rpc";
import type { ChatHostPorts } from "@workspace/agentic-core/chat-store";

/**
 * "Report a problem" for a chat message, over the routed workspace session.
 *
 * The selected message becomes one bounded, reviewable draft owned by this
 * client; nothing is sent without the host's own sharing approval. The
 * reporting conversation then opens as a new chat in this window: the shell's
 * command-agent surface belongs to the browser client, which a chat window
 * does not reach.
 */
export function createChatProblemReports(deps: {
  rpc: Pick<RpcCaller, "call">;
  /** The participant identity of this client; prefixes every evidence coordinate. */
  clientId: string;
  /** Open the reporting conversation, seeded with the prompt that names the draft. */
  startConversation(prompt: string): void;
}): NonNullable<ChatHostPorts["problemReports"]> {
  return {
    report: async (selection) => {
      const coordinate = JSON.stringify({ clientId: deps.clientId, ...selection.coordinate });
      const reference = await draftSelectedProblem(deps.rpc, {
        problem: selection.problem,
        source: selection.source,
        coordinate,
        value: selection.value,
        reference: { kind: "message", coordinate },
      });
      deps.startConversation(problemReportingConversation(reference));
    },
  };
}
