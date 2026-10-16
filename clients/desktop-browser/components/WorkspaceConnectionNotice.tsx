import { useMemo } from "react";
import { ConnectionNotice } from "@workspace/client-kit-web";
import type { ConnectionPort } from "@workspace/connection-core";
import type { WorkspaceConnectionState } from "@vibestudio/shared/workspaceConnection";

import { useShellWorkspaceClient } from "../shell/workspaceContext";

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

/**
 * The desktop's availability banner: the host's connection bridge and the
 * remote-credential recovery actions, presented by the kit's `ConnectionNotice`.
 */
export function WorkspaceConnectionNotice({
  onOpenSettings,
}: {
  onOpenSettings: () => void;
}) {
  const { remoteCred } = useShellWorkspaceClient();
  const port = useMemo<ConnectionPort>(() => {
    const bridge = connectionBridge();
    return {
      current: () => bridge.getCurrent(),
      onChange: (handler) => bridge.onChange(handler),
      reconnectNow: () => remoteCred.reconnectNow(),
      relaunch: async () => {
        await remoteCred.relaunch();
      },
    };
  }, [remoteCred]);
  return <ConnectionNotice port={port} onOpenSettings={onOpenSettings} />;
}
