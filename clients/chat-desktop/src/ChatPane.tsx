import { lazy, Suspense, useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Button, Callout, Flex, Spinner, Text } from "@radix-ui/themes";
import type { AgenticChatFeature } from "@workspace/agentic-chat/features";
import type {
  AgenticChatActions,
  ForkNavHandlers,
  NewConversationOptions,
} from "@workspace/agentic-chat/types";
import {
  ChatHostController,
  chatHostActionData,
  createChatHostPorts,
  type ChatHostNotification,
  type ChatHostSnapshot,
  type UserFacingError,
} from "@workspace/agentic-core/chat-store";
import type { ConversationRef } from "./conversations";
import { conversationState } from "./conversationState";
import type { ChatSession } from "./session";

const AgenticChat = lazy(() =>
  import("@workspace/agentic-chat/chat").then((module) => ({ default: module.AgenticChat }))
);

/**
 * Optional chat surfaces that run authored code against the panel runtime
 * (the action bar and client-side eval) or report through a panel (feedback,
 * inline UI). A client window is not a panel, so none is offered; the
 * transcript, composer, agents, forks and approvals are the stock chat.
 */
export const CHAT_FEATURES: readonly AgenticChatFeature[] = [];

let instanceSerial = 0;

export interface ChatPaneProps {
  session: ChatSession;
  conversation: ConversationRef;
  theme: "light" | "dark";
  /** The conversation's channel, once the host has one (a new chat has none until then). */
  onChannel(channelName: string): void;
  onOpenConversation(channelName: string, contextId?: string): void;
  onNewChat(options?: NewConversationOptions): void;
}

/**
 * One conversation: a `ChatHostController` over the routed workspace session,
 * rendered by the stock `AgenticChat`. The chat panel is the same pairing over
 * its panel runtime; only the ports differ.
 */
export function ChatPane(props: ChatPaneProps) {
  const { session, conversation, theme, onChannel, onOpenConversation, onNewChat } = props;
  const [notice, setNotice] = useState<ChatHostNotification | null>(null);

  const { controller, state } = useMemo(() => {
    const state = conversationState({
      ...(conversation.channelName ? { channelName: conversation.channelName } : {}),
      ...(conversation.options?.agentConfig
        ? { agentConfig: conversation.options.agentConfig as Record<string, unknown> }
        : {}),
    });
    const ports = createChatHostPorts({
      rpc: session.rpc,
      contextId: conversation.contextId,
      instanceId: `chat-desktop:${(instanceSerial += 1)}`,
      state,
      events: session.events,
      notify: (next) => setNotice(next),
    });
    return { controller: new ChatHostController(ports), state };
  }, [session, conversation]);

  useEffect(() => controller.retain(), [controller]);
  const host: ChatHostSnapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot
  );
  const hostState = useSyncExternalStore(state.subscribe, state.get, state.get);
  const channelName = host.channelName;
  useEffect(() => {
    if (channelName) onChannel(channelName);
  }, [channelName, onChannel]);

  const config = useMemo(
    () => ({ clientId: session.clientId, rpc: session.rpc }),
    [session.clientId, session.rpc]
  );
  const channelConfig = useMemo(
    () => (conversation.options?.seed ? { seed: conversation.options.seed } : undefined),
    [conversation.options]
  );

  const actions: AgenticChatActions = useMemo(
    () => ({
      ...controller.actions,
      ...chatHostActionData(host),
      onNewConversation: (options) => onNewChat(options),
      onOpenChannel: async (channelId) => onOpenConversation(channelId),
    }),
    // `host` fields the action data reads; the controller's own actions are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      controller,
      host.availableAgents,
      host.modelCatalog,
      host.workspaceDefaultModelRef,
      host.effectiveDefaultAgentConfig,
      host.firstAgentModelPreflight,
      onNewChat,
      onOpenConversation,
    ]
  );

  // One window: a fork opens in place of the conversation it came from.
  const forkNav: ForkNavHandlers = useMemo(
    () => ({
      switchTo: async (forkChannelId, forkContextId) =>
        onOpenConversation(forkChannelId, forkContextId),
      openInNewPanel: async (forkChannelId, forkContextId) =>
        onOpenConversation(forkChannelId, forkContextId),
      readForkCursors: () => controller.readForkCursors(),
      markForkRead: (forkChannelId, headSeq) => controller.markForkRead(forkChannelId, headSeq),
    }),
    [controller, onOpenConversation]
  );

  const metadata = useMemo(
    () => ({
      name: channelName ?? "Channel",
      type: "panel" as const,
      surface: "browser" as const,
      hostPlatform: "electron" as const,
    }),
    [channelName]
  );

  if (!channelName) {
    return (
      <Flex align="center" justify="center" gap="2" style={{ height: "100%" }}>
        <Spinner size="1" />
        <Text size="2" color="gray">
          Starting chat…
        </Text>
      </Flex>
    );
  }
  return (
    <Flex direction="column" style={{ height: "100%", minWidth: 0 }}>
      {host.modelSettingsError ? (
        <HostFailure failure={host.modelSettingsError} onRetry={() => controller.retryModelSettings()} />
      ) : null}
      {host.agentCatalogError ? (
        <HostFailure failure={host.agentCatalogError} onRetry={() => controller.retryAgentCatalog()} />
      ) : null}
      {host.recovery.status === "failed" && host.recovery.error ? (
        <HostFailure failure={host.recovery.error} onRetry={() => controller.retryAgentRecovery()} />
      ) : host.recovery.status === "recovering" ? (
        <Callout.Root color="blue" size="1" style={{ borderRadius: 0 }}>
          <Flex align="center" gap="2" width="100%">
            <Spinner size="1" />
            <Callout.Text>Reconnecting your agents to this conversation…</Callout.Text>
          </Flex>
        </Callout.Root>
      ) : null}
      {notice ? <Notice notice={notice} onDismiss={() => setNotice(null)} /> : null}
      <div style={{ flex: "1 1 0", minHeight: 0, overflow: "hidden" }}>
        <Suspense
          fallback={
            <Flex align="center" justify="center" style={{ height: "100%" }}>
              <Spinner size="1" />
            </Flex>
          }
        >
          <AgenticChat
            heightMode="container"
            config={config}
            channelName={channelName}
            {...(channelConfig ? { channelConfig } : {})}
            contextId={conversation.contextId}
            metadata={metadata}
            actions={actions}
            theme={theme}
            installedAgents={hostState.installedAgents ?? undefined}
            forkNav={forkNav}
            features={CHAT_FEATURES}
            connectionRetrySignal={host.connectionRetrySignal}
          />
        </Suspense>
      </div>
    </Flex>
  );
}

function Notice({ notice, onDismiss }: { notice: ChatHostNotification; onDismiss(): void }) {
  const color = notice.type === "error" ? "red" : notice.type === "warning" ? "amber" : "blue";
  return (
    <Callout.Root color={color} size="1" style={{ borderRadius: 0 }} role="status">
      <Flex align="center" justify="between" gap="3" width="100%">
        <Callout.Text>
          <Text weight="medium">{notice.title}.</Text> {notice.message}
        </Callout.Text>
        <Button size="1" variant="ghost" color="gray" onClick={onDismiss}>
          Dismiss
        </Button>
      </Flex>
    </Callout.Root>
  );
}

function HostFailure({ failure, onRetry }: { failure: UserFacingError; onRetry(): void }) {
  const [detail, setDetail] = useState(false);
  const toggle = useCallback(() => setDetail((value) => !value), []);
  return (
    <Callout.Root color="red" size="1" style={{ borderRadius: 0 }} role="alert">
      <Flex direction="column" gap="1" width="100%">
        <Flex align="center" justify="between" gap="3" width="100%">
          <Callout.Text>
            <Text weight="medium">{failure.title}.</Text> {failure.message}
          </Callout.Text>
          <Flex gap="2" flexShrink="0">
            {failure.detail ? (
              <Button size="1" variant="ghost" color="red" aria-expanded={detail} onClick={toggle}>
                {detail ? "Hide details" : "Details"}
              </Button>
            ) : null}
            <Button size="1" variant="soft" color="red" onClick={onRetry}>
              Retry
            </Button>
          </Flex>
        </Flex>
        {detail && failure.detail ? (
          <Text as="div" size="1" color="gray" style={{ fontFamily: "var(--code-font-family)", whiteSpace: "pre-wrap" }}>
            {failure.detail}
          </Text>
        ) : null}
      </Flex>
    </Callout.Root>
  );
}
