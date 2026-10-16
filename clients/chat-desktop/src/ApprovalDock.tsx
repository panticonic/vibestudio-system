import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, Callout, Flex, Text } from "@radix-ui/themes";
import {
  approvalQueueInfo,
  createApprovalQueue,
  resolveCallerInfo,
} from "@workspace/approvals-core";
import {
  ApprovalCard,
  approvalOpensFullSurface,
  useSnapshot,
  userFacingError,
  type ApprovalCardIntent,
} from "@workspace/client-kit-web";
import { answerApproval } from "./approvalIntents";
import type { ChatSession } from "./session";

/**
 * The approvals the conversation's agents raise, answered in this window
 * (`approval-surface`). The workspace's queue is authoritative: the dock mirrors
 * it, so an answer given anywhere retires the card everywhere. The card is
 * drawn by this client, never by the conversation, so nothing a transcript
 * prints can imitate it.
 */
export function ApprovalDock({
  session,
  appearance,
}: {
  session: Pick<ChatSession, "approvals" | "workspaceId">;
  appearance: "light" | "dark";
}) {
  const queue = useMemo(() => createApprovalQueue(session.approvals), [session.approvals]);
  const state = useSnapshot(queue);
  const [loadError, setLoadError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    queue.start().catch((error: unknown) => {
      if (live) setLoadError(userFacingError(error, "Approvals could not be read."));
    });
    return () => {
      live = false;
      void queue.stop().catch(() => undefined);
    };
  }, [queue]);

  const [index, setIndex] = useState(0);
  const [minimized, setMinimized] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ approvalId: string; message: string } | null>(null);

  const pending = state.pending;
  const position = Math.min(index, Math.max(pending.length - 1, 0));
  const approval = pending[position];
  // A new request opens the dock again; the person minimized the one they saw.
  const count = pending.length;
  useEffect(() => {
    if (count > 0) setMinimized(false);
  }, [count]);

  const emit = useCallback(
    (intent: ApprovalCardIntent) => {
      if (!approval) return;
      if (intent.type === "minimize") return setMinimized(true);
      if (intent.type === "browse") {
        return setIndex(position + (intent.dir === "prev" ? -1 : 1));
      }
      setFailure(null);
      setBusy(approval.approvalId);
      answerApproval(session.approvals, approval, intent)
        .catch(async (error: unknown) => {
          // A refused answer may mean the request was already answered or withdrawn;
          // only the authoritative queue says whether anything is left to answer.
          await queue.refresh().catch(() => undefined);
          const stillPending = queue
            .getSnapshot()
            .pending.some((item) => item.approvalId === approval.approvalId);
          if (stillPending)
            setFailure({ approvalId: approval.approvalId, message: userFacingError(error) });
        })
        .finally(() => setBusy((current) => (current === approval.approvalId ? null : current)));
    },
    [approval, position, queue, session.approvals]
  );

  if (!approval) {
    return loadError ? (
      <Callout.Root color="red" size="1" role="alert" className="chat-approval-dock">
        <Callout.Text>{loadError}</Callout.Text>
      </Callout.Root>
    ) : null;
  }
  if (minimized) {
    return (
      <Flex className="chat-approval-dock" justify="end" p="2">
        <Button size="2" color="amber" onClick={() => setMinimized(false)}>
          Approvals waiting <Badge color="amber">{count}</Badge>
        </Button>
      </Flex>
    );
  }
  if (approvalOpensFullSurface(approval)) {
    return (
      <Callout.Root color="amber" size="1" role="status" className="chat-approval-dock">
        <Callout.Text>
          <Text weight="medium">A review is waiting.</Text> It needs the Vibestudio browser; answer
          it there and this conversation continues.
        </Callout.Text>
      </Callout.Root>
    );
  }
  return (
    <div className="chat-approval-dock" role="dialog" aria-label="Approval request">
      <ApprovalCard
        workspaceLabel="Personal"
        presentationKey={session.workspaceId}
        approval={approval}
        caller={resolveCallerInfo(approval)}
        queue={approvalQueueInfo(position, count)}
        decisionError={failure?.approvalId === approval.approvalId ? failure.message : null}
        actionPending={busy === approval.approvalId}
        appearance={appearance}
        layout="card"
        emit={(intent) => emit(intent)}
      />
    </div>
  );
}
