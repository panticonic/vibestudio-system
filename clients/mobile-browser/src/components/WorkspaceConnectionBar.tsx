import { useEffect, useState } from "react";
import { useAtomValue } from "jotai";
import { ConnectionBar } from "@workspace/client-kit-native";
import { createConnectionTracker } from "@workspace/connection-core";
import {
  connectionStatusAtom,
  networkReachableAtom,
  workspaceReadinessAtom,
} from "../state/connectionAtoms";
import { shellClientAtom } from "../state/shellClientAtom";

/**
 * The kit's connection bar, fed by this app's transport: the status the shell
 * client reports, the device's reachability (NetInfo, via `networkReachableAtom`)
 * and the transport's reconnect progress all go through one connection tracker.
 */
export function WorkspaceConnectionBar({ onRepair }: { onRepair?: () => void }) {
  const status = useAtomValue(connectionStatusAtom);
  const networkReachable = useAtomValue(networkReachableAtom);
  const readiness = useAtomValue(workspaceReadinessAtom);
  const shellClient = useAtomValue(shellClientAtom);
  const [tracker] = useState(createConnectionTracker);

  useEffect(() => tracker.transport(status), [tracker, status]);
  useEffect(
    () => tracker.networkReachable(networkReachable),
    [tracker, networkReachable],
  );
  useEffect(() => {
    if (!shellClient) return;
    return shellClient.transport.onReconnectProgress((progress) =>
      tracker.reconnectProgress({ attempt: progress.attempt }),
    );
  }, [shellClient, tracker]);

  return (
    <ConnectionBar
      tracker={tracker}
      readiness={readiness}
      onReconnect={() => shellClient?.transport.reconnect()}
      onRetrySetup={() => shellClient?.retryWorkspaceSetup()}
      {...(onRepair ? { onRepair } : {})}
    />
  );
}
