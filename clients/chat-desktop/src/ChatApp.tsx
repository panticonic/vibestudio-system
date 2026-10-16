import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Button, Flex, Spinner, Text, Theme } from "@radix-ui/themes";
import { createOwnerRpcs, userFacingError } from "@workspace/client-kit-web";
import { APP_THEME } from "@workspace/ui/theme";
import { ChatWorkspace } from "./ChatWorkspace";
import type { HostBridge } from "./hostBridge";
import { openChatSession, type ChatSession } from "./session";

type Connection =
  | { status: "opening" }
  | { status: "ready"; session: ChatSession }
  | { status: "failed"; message: string };

/**
 * The chat's connection to the Personal workspace. A failure to open is shown
 * with a Retry the person presses; nothing retries on its own, and the
 * transport's own recovery handles drops once the session is open.
 */
function useChatSession(host: HostBridge): { connection: Connection; retry(): void } {
  const [attempt, setAttempt] = useState(0);
  const [connection, setConnection] = useState<Connection>({ status: "opening" });
  useEffect(() => {
    const owners = createOwnerRpcs(host);
    let live = true;
    setConnection({ status: "opening" });
    openChatSession(owners, host.transport.identity).then(
      (session) => {
        if (live) setConnection({ status: "ready", session });
      },
      (error: unknown) => {
        if (live) setConnection({ status: "failed", message: userFacingError(error) });
      }
    );
    return () => {
      live = false;
      owners.close();
    };
  }, [host, attempt]);
  return { connection, retry: () => setAttempt((value) => value + 1) };
}

const DARK_QUERY = "(prefers-color-scheme: dark)";

function useAppearance(): "light" | "dark" {
  const query = useMemo(() => window.matchMedia(DARK_QUERY), []);
  const dark = useSyncExternalStore(
    (listener) => {
      query.addEventListener("change", listener);
      return () => query.removeEventListener("change", listener);
    },
    () => query.matches
  );
  return dark ? "dark" : "light";
}

export function ChatApp({ host }: { host: HostBridge }) {
  const appearance = useAppearance();
  const { connection, retry } = useChatSession(host);
  return (
    <Theme appearance={appearance} {...APP_THEME} panelBackground="solid" hasBackground>
      {connection.status === "ready" ? (
        <ChatWorkspace host={host} session={connection.session} appearance={appearance} />
      ) : (
        <Flex direction="column" align="center" justify="center" gap="3" p="5" style={{ height: "100dvh" }}>
          {connection.status === "opening" ? (
            <Spinner size="3" aria-label="Opening chat" />
          ) : (
            <>
              <Text color="gray" align="center">
                {connection.message}
              </Text>
              <Button variant="soft" onClick={retry}>
                Retry
              </Button>
            </>
          )}
        </Flex>
      )}
    </Theme>
  );
}
