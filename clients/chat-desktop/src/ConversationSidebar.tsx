import { Button, Callout, Flex, ScrollArea, Spinner, Text } from "@radix-ui/themes";
import { PlusIcon } from "@radix-ui/react-icons";
import type { ChannelListing } from "./conversations";

export type ConversationList =
  | { status: "loading" }
  | { status: "ready"; conversations: readonly ChannelListing[] }
  | { status: "failed"; message: string };

/** The conversations beside the transcript, newest first, and the way to start another. */
export function ConversationSidebar({
  list,
  activeChannel,
  onNewChat,
  onOpen,
  onRetry,
}: {
  list: ConversationList;
  activeChannel: string | null;
  onNewChat(): void;
  onOpen(conversation: ChannelListing): void;
  onRetry(): void;
}) {
  return (
    <Flex direction="column" className="chat-sidebar" asChild>
      <nav aria-label="Conversations">
        <Flex p="2">
          <Button size="2" variant="soft" style={{ flex: 1 }} onClick={onNewChat}>
            <PlusIcon /> New Chat
          </Button>
        </Flex>
        <ScrollArea type="auto" scrollbars="vertical" style={{ flex: "1 1 0" }}>
          {list.status === "loading" ? (
            <Flex justify="center" p="3">
              <Spinner size="1" />
            </Flex>
          ) : list.status === "failed" ? (
            <Callout.Root color="red" size="1" role="alert" m="2">
              <Flex direction="column" gap="2">
                <Callout.Text>{list.message}</Callout.Text>
                <Button size="1" variant="soft" color="red" onClick={onRetry}>
                  Retry
                </Button>
              </Flex>
            </Callout.Root>
          ) : list.conversations.length === 0 ? (
            <Text as="p" size="2" color="gray" m="3">
              No conversations yet.
            </Text>
          ) : (
            <ul className="chat-sidebar-list">
              {list.conversations.map((conversation) => (
                <li key={conversation.channelId}>
                  <button
                    type="button"
                    className="chat-sidebar-item"
                    aria-current={conversation.channelId === activeChannel ? "true" : undefined}
                    onClick={() => onOpen(conversation)}
                  >
                    <Text size="2" truncate>
                      {conversation.title}
                    </Text>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </ScrollArea>
      </nav>
    </Flex>
  );
}
