import { Button, Flex, Spinner, Text } from "@radix-ui/themes";
import { CrossCircledIcon, ReloadIcon } from "@radix-ui/react-icons";
import { useEffect, useState } from "react";
import {
  workspaceConnectionPresentation,
  type WorkspaceConnectionState,
} from "@vibestudio/shared/workspaceConnection";

import { useShellWorkspaceClient } from "../shell/workspaceContext";

const TRANSIENT_OUTAGE_DELAY_MS = 350;

type WorkspaceConnectionBridge = {
  getCurrent(): Promise<WorkspaceConnectionState>;
  onChange(handler: (state: WorkspaceConnectionState) => void): () => void;
};

function connectionBridge(): WorkspaceConnectionBridge {
  const bridge = (
    globalThis as typeof globalThis & {
      __vibestudioWorkspaceConnection?: WorkspaceConnectionBridge;
    }
  ).__vibestudioWorkspaceConnection;
  if (!bridge) throw new Error("Workspace connection bridge is unavailable");
  return bridge;
}

/** One calm, persistent availability surface for the complete desktop. */
export function WorkspaceConnectionNotice({
  onOpenSettings,
}: {
  onOpenSettings: () => void;
}) {
  const { remoteCred } = useShellWorkspaceClient();
  const [state, setState] = useState<WorkspaceConnectionState | null>(null);
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const bridge = connectionBridge();
    let active = true;
    const remove = bridge.onChange((next) => {
      if (active) setState(next);
    });
    void bridge.getCurrent().then((next) => {
      if (active) setState(next);
    });
    return () => {
      active = false;
      remove();
    };
  }, []);

  const phase = state?.phase ?? "starting";
  useEffect(() => {
    if (phase === "ended") {
      setVisible(true);
      return;
    }
    if (phase !== "reconnecting") {
      setVisible(false);
      return;
    }
    const timer = window.setTimeout(
      () => setVisible(true),
      TRANSIENT_OUTAGE_DELAY_MS,
    );
    return () => window.clearTimeout(timer);
  }, [phase]);

  const presentation = state ? workspaceConnectionPresentation(state) : null;
  if (!visible || !presentation) return null;

  const terminal = state?.phase === "ended";
  const recover = async () => {
    setBusy(true);
    setError(null);
    try {
      if (terminal) await remoteCred.relaunch();
      else await remoteCred.reconnectNow();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="workspace-connection-notice"
      data-terminal={terminal}
      role={terminal ? "alert" : "status"}
      aria-live={terminal ? "assertive" : "polite"}
      aria-label={presentation.title}
    >
      {presentation.showSpinner ? (
        <Spinner size="2" />
      ) : (
        <CrossCircledIcon width="18" height="18" color="var(--red-9)" />
      )}
      <div className="workspace-connection-notice-copy">
        <Text size="2" weight="bold">
          {presentation.title}
        </Text>
        <Text
          className="workspace-connection-notice-message"
          size="2"
          color="gray"
        >
          {presentation.message}
        </Text>
        {presentation.retryDetail ? (
          <Text size="1" color="gray">
            {presentation.retryDetail}
          </Text>
        ) : null}
        {error ? (
          <Text className="workspace-connection-notice-error" size="2">
            {error}
          </Text>
        ) : null}
      </div>
      <Flex className="workspace-connection-notice-actions" gap="2">
        <Button
          size="1"
          variant="soft"
          disabled={busy}
          onClick={() => void recover()}
        >
          <ReloadIcon /> {terminal ? "Restart Vibestudio" : "Retry now"}
        </Button>
        {presentation.showSettings ? (
          <Button size="1" variant="ghost" onClick={onOpenSettings}>
            Connection settings
          </Button>
        ) : null}
      </Flex>
    </div>
  );
}
