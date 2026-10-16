import { useCallback, useEffect, useMemo, useState } from "react";
import { Callout, Button, Flex, Spinner, Text } from "@radix-ui/themes";
import type { NewConversationOptions } from "@workspace/agentic-core";
import { userFacingError } from "@workspace/client-kit-web";
import { ClientUpdatePrompt } from "@workspace/client-kit-web";
import { ApprovalDock } from "./ApprovalDock";
import { useChatUpdates } from "./update";
import { ChatPane } from "./ChatPane";
import { useChatMenu } from "./chatMenu";
import { clientIdOf, useChatIntegration } from "./integration";
import {
  listConversations,
  resolveTarget,
  type ChannelListing,
  type ConversationRef,
} from "./conversations";
import { ConversationSidebar, type ConversationList } from "./ConversationSidebar";
import type { HostBridge } from "./hostBridge";
import { applyIntent, INITIAL_LAUNCH, openConversation as launchConversation, type Launch } from "./launch";
import type { ChatSession } from "./session";
import { useConnectionPhase } from "./useConnectionPhase";

type View =
  | { status: "resolving" }
  | { status: "ready"; generation: number; conversation: ConversationRef }
  | { status: "failed"; message: string };

/**
 * The single window: conversations beside the transcript, approvals answered
 * over it. What it shows follows `launch`, which the person changes from the
 * sidebar, the menu, a fork, or a foreground intent the host relays.
 */
export function ChatWorkspace({
  host,
  session,
  appearance,
}: {
  host: HostBridge;
  session: ChatSession;
  appearance: "light" | "dark";
}) {
  const [launch, setLaunch] = useState<Launch>(INITIAL_LAUNCH);
  const [view, setView] = useState<View>({ status: "resolving" });
  const [retry, setRetry] = useState(0);
  const [activeChannel, setActiveChannel] = useState<string | null>(null);
  const [list, setList] = useState<ConversationList>({ status: "loading" });

  useEffect(
    () => host.client.intents.subscribe((intent) => setLaunch((current) => applyIntent(current, intent))),
    [host]
  );

  useEffect(() => {
    let live = true;
    setView({ status: "resolving" });
    resolveTarget(session.rpc, launch.target, host.client.state).then(
      (conversation) => {
        if (!live) return;
        setActiveChannel(conversation.channelName);
        setView({ status: "ready", generation: launch.generation, conversation });
      },
      (error: unknown) => {
        if (live) setView({ status: "failed", message: userFacingError(error) });
      }
    );
    return () => {
      live = false;
    };
  }, [session, host, launch, retry]);

  // The list follows the active conversation: a new chat appears once it has a channel.
  const [listRetry, setListRetry] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    listConversations(session.rpc, activeChannel, abort.signal).then(
      (conversations) => setList({ status: "ready", conversations }),
      (error: unknown) => {
        if (!abort.signal.aborted) setList({ status: "failed", message: userFacingError(error) });
      }
    );
    return () => abort.abort();
  }, [session, activeChannel, listRetry]);
  const conversations = useMemo<readonly ChannelListing[]>(
    () => (list.status === "ready" ? list.conversations : []),
    [list]
  );

  const [menuFailure, setMenuFailure] = useState<string | null>(null);
  const newChat = useCallback((options?: NewConversationOptions) => {
    setLaunch((current) => launchConversation(current, { kind: "new", ...(options ? { options } : {}) }));
  }, []);
  const openChannel = useCallback((channelName: string, contextId?: string) => {
    setLaunch((current) =>
      launchConversation(current, {
        kind: "conversation",
        channelName,
        ...(contextId ? { contextId } : {}),
      })
    );
  }, []);
  const openListed = useCallback(
    (conversation: ChannelListing) => openChannel(conversation.channelId, conversation.contextId),
    [openChannel]
  );
  const { launcher, toggleLauncher } = useChatIntegration(
    host.client,
    clientIdOf(host.transport.identity.runtimeId),
    setMenuFailure
  );
  useChatMenu(
    host.client,
    conversations,
    useMemo(
      () => ({
        newChat: () => newChat(),
        toggleLauncher,
        openConversation: (channelId: string) => {
          const found = conversations.find((entry) => entry.channelId === channelId);
          openChannel(channelId, found?.contextId);
        },
        failed: (action: string, error: unknown) =>
          setMenuFailure(`${action}: ${userFacingError(error)}`),
      }),
      [conversations, newChat, openChannel, toggleLauncher]
    ),
    launcher
  );

  const phase = useConnectionPhase(host.connection);
  const updates = useChatUpdates(host);

  return (
    <div className="chat-window">
      <ConversationSidebar
        list={list}
        activeChannel={activeChannel}
        onNewChat={() => newChat()}
        onOpen={openListed}
        onRetry={() => setListRetry((value) => value + 1)}
      />
      <main className="chat-main">
        {phase !== "online" ? (
          <div className="chat-connection-banner" role="status">
            {phase === "ended"
              ? "The connection to your workspace ended. Relaunch Chat to reconnect."
              : "Reconnecting to your workspace…"}
          </div>
        ) : null}
        <ClientUpdatePrompt model={updates} />
        {menuFailure ? (
          <Callout.Root color="red" size="1" role="alert" style={{ borderRadius: 0 }}>
            <Flex align="center" justify="between" width="100%">
              <Callout.Text>{menuFailure}</Callout.Text>
              <Button size="1" variant="ghost" color="gray" onClick={() => setMenuFailure(null)}>
                Dismiss
              </Button>
            </Flex>
          </Callout.Root>
        ) : null}
        <div style={{ flex: "1 1 0", minHeight: 0 }}>
          {view.status === "ready" ? (
            <ChatPane
              key={view.generation}
              session={session}
              conversation={view.conversation}
              theme={appearance}
              onChannel={setActiveChannel}
              onOpenConversation={openChannel}
              onNewChat={newChat}
            />
          ) : view.status === "failed" ? (
            <Flex direction="column" align="center" justify="center" gap="3" p="5" style={{ height: "100%" }}>
              <Text color="gray" align="center">
                {view.message}
              </Text>
              <Button variant="soft" onClick={() => setRetry((value) => value + 1)}>
                Retry
              </Button>
            </Flex>
          ) : (
            <Flex align="center" justify="center" style={{ height: "100%" }}>
              <Spinner size="2" aria-label="Opening conversation" />
            </Flex>
          )}
        </div>
        <ApprovalDock session={session} appearance={appearance} />
      </main>
    </div>
  );
}
