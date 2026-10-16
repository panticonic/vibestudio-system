import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View, useColorScheme } from "react-native";
import type { RnClientApi } from "@vibestudio/rn-client-api";
import {
  ChatScreen,
  darkChatNativeTheme,
  lightChatNativeTheme,
  type ChatNativeTheme,
} from "@workspace/agentic-chat-native";
import {
  createHostUpdateModel,
  observeHostUpdates,
  presentClientUpdates,
} from "@workspace/client-kit-native";
import { installClientApi } from "@workspace/client-kit-native/host";
import { openChatConnection, type ChatConnection } from "./chatSession";
import { createClientHostPorts, LAST_CONVERSATION_KEY } from "./hostPorts";
import { applyIntent, initialLaunch, type ChatLaunch } from "./launch";

type Connection =
  | { status: "opening" }
  | { status: "ready"; chat: ChatConnection; lastConversation: string | null }
  | { status: "failed"; message: string };

/**
 * The chat connection of this client instance. Opening failures are shown with
 * a Retry the person presses; nothing retries on its own, and the connection's
 * own recovery handles drops after it is open.
 */
function useChatConnection(api: RnClientApi): { connection: Connection; retry: () => void } {
  const [attempt, setAttempt] = useState(0);
  const [connection, setConnection] = useState<Connection>({ status: "opening" });
  useEffect(() => {
    let current: ChatConnection | null = null;
    let disposed = false;
    setConnection({ status: "opening" });
    void (async () => {
      try {
        const chat = await openChatConnection(api);
        const lastConversation = await api.state.get(LAST_CONVERSATION_KEY);
        if (disposed) {
          await chat.close();
          return;
        }
        current = chat;
        setConnection({ status: "ready", chat, lastConversation });
      } catch (error) {
        if (!disposed) {
          setConnection({
            status: "failed",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    })();
    return () => {
      disposed = true;
      void current?.close().catch((error: unknown) => console.warn("[chat] close failed:", error));
    };
  }, [api, attempt]);
  return { connection, retry: () => setAttempt((value) => value + 1) };
}

/** Ask the person about ready builds of this client; the host reloads only this instance. */
function useClientUpdates(api: RnClientApi): void {
  useEffect(() => {
    const model = createHostUpdateModel(api);
    const stopPresenting = presentClientUpdates(model, {
      alert: Alert.alert,
      notify: (toast) => Alert.alert(toast.title, toast.message),
    });
    const stopObserving = observeHostUpdates(api, model);
    return () => {
      stopObserving();
      stopPresenting();
    };
  }, [api]);
}

function Message({ theme, children }: { theme: ChatNativeTheme; children: string }) {
  return <Text style={{ color: theme.textSecondary, textAlign: "center" }}>{children}</Text>;
}

export function ChatClient({ api }: { api: RnClientApi }) {
  useState(() => installClientApi(api));
  const scheme = useColorScheme();
  const theme = scheme === "dark" ? darkChatNativeTheme : lightChatNativeTheme;
  const { connection, retry } = useChatConnection(api);
  useClientUpdates(api);

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      {connection.status === "opening" ? (
        <View style={styles.center}>
          <ActivityIndicator accessibilityLabel="Opening chat" />
        </View>
      ) : connection.status === "failed" ? (
        <View style={styles.center}>
          <Message theme={theme}>{connection.message}</Message>
          <Pressable accessibilityRole="button" onPress={retry} hitSlop={8}>
            <Text style={{ color: theme.accent, fontWeight: "600" }}>Retry</Text>
          </Pressable>
        </View>
      ) : (
        <ReadyChat api={api} chat={connection.chat} lastConversation={connection.lastConversation} theme={theme} />
      )}
    </View>
  );
}

function ReadyChat({
  api,
  chat,
  lastConversation,
  theme,
}: {
  api: RnClientApi;
  chat: ChatConnection;
  lastConversation: string | null;
  theme: ChatNativeTheme;
}) {
  const [launch, setLaunch] = useState<ChatLaunch>(() => initialLaunch(api.intent.initial, lastConversation));
  useEffect(
    () => api.intent.onIntent((intent) => setLaunch((current) => applyIntent(current, intent))),
    [api]
  );

  const report = useCallback((message: string, error: unknown) => {
    console.warn(`[chat] ${message}:`, error);
  }, []);
  const hostPorts = useMemo(() => createClientHostPorts(chat, api, report), [chat, api, report]);
  const canCopy = api.capabilities.has("clipboard");
  const canOpen = api.capabilities.has("open-external");
  const copy = useCallback((text: string) => api.clipboard.setString(text), [api]);
  const openLink = useCallback(
    (href: string) => {
      if (!canOpen) {
        Alert.alert("Cannot open link", "This device has not allowed Chat to open links.");
        return;
      }
      api.openExternal(href).catch((error: unknown) => report("Could not open the link", error));
    },
    [api, canOpen, report]
  );

  return (
    <ChatScreen
      key={launch.generation}
      hostPorts={hostPorts}
      connection={chat.connection}
      contextId={chat.contextId}
      channelName={launch.channelName}
      {...(launch.initialInput ? { initialInput: launch.initialInput } : {})}
      theme={theme}
      openLink={openLink}
      {...(canCopy ? { copy } : {})}
    />
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 16 },
});
