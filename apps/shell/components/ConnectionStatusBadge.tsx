import { useShellWorkspaceClient } from "../shell/workspaceContext";
/**
 * ConnectionStatusBadge — chrome indicator for server connection state.
 *
 * Intentionally visible in both local and remote modes: besides status, this is
 * the stable entry point for connection settings and companion-device pairing.
 */

import { useCallback, useEffect, useState } from "react";
import { Badge, IconButton, Tooltip } from "@radix-ui/themes";
import { CrossCircledIcon, GlobeIcon, UpdateIcon } from "@radix-ui/react-icons";

import { useShellEvent } from "../shell/useShellEvent";
import { connectionStatusCopy, type ConnectionStatus } from "./connectionStatusCopy";

type ConnectionMode = "local" | "remote";
interface RemoteTransport {
  path: "direct" | "relay";
  relayUrl?: string;
  rttMs?: number;
  endpointGeneration?: number;
}

interface ConnectionSnapshot {
  mode: ConnectionMode;
  status: ConnectionStatus;
  remoteHost?: string;
  remoteTransport?: RemoteTransport | null;
}

export function ConnectionStatusBadge({
  onOpenSettings,
}: {
  onOpenSettings: () => void;
}) {
  const { app } = useShellWorkspaceClient();

  const [snap, setSnap] = useState<ConnectionSnapshot | null>(null);
  const [hasConnected, setHasConnected] = useState(false);

  useEffect(() => {
    app
      .getInfo()
      .then((info) => {
        setSnap({
          mode: info.connectionMode ?? "local",
          status: info.connectionStatus ?? "connected",
          remoteHost: info.remoteHost,
          remoteTransport: info.remoteTransport ?? null,
        });
        if ((info.connectionStatus ?? "connected") === "connected")
          setHasConnected(true);
      })
      .catch((error) => {
        console.warn(
          "[ConnectionStatusBadge] Failed to load connection status:",
          error,
        );
      });
  }, []);

  useShellEvent(
    "server-connection-changed",
    useCallback(
      (payload: {
        status: ConnectionStatus;
        isRemote: boolean;
        remoteHost?: string;
        remoteTransport?: RemoteTransport;
      }) => {
        setSnap((current) => ({
          mode: payload.isRemote ? "remote" : "local",
          status: payload.status,
          remoteHost: payload.remoteHost,
          remoteTransport:
            payload.status === "connected"
              ? (payload.remoteTransport ?? current?.remoteTransport ?? null)
              : null,
        }));
        if (payload.status === "connected") setHasConnected(true);
      },
      [],
    ),
  );

  useShellEvent(
    "remote-transport-diagnostics-changed",
    useCallback(
      (payload: { remoteTransport: RemoteTransport | null }) => {
        setSnap((current) =>
          current && current.mode === "remote"
            ? { ...current, remoteTransport: payload.remoteTransport }
            : current,
        );
      },
      [],
    ),
  );

  // Until the first status arrives, keep the slot occupied so the title bar
  // does not shift when the badge appears.
  const status = snap?.status ?? "connecting";
  const mode = snap?.mode ?? "local";
  const summary = snap
    ? connectionStatusCopy({
        status,
        isRemote: mode === "remote",
        remoteHost: snap.remoteHost,
        hasConnected,
      })
    : "Checking connection…";

  // Relay fallback is expected behavior; surface the active path without
  // presenting it as a security downgrade.
  const isRelayed =
    status === "connected" && mode === "remote" && snap?.remoteTransport?.path === "relay";
  let tooltip = summary;
  if (status === "connected" && mode === "remote" && snap?.remoteTransport) {
    tooltip += isRelayed
      ? `\nConnected through a relay${snap.remoteTransport.relayUrl ? ` (${snap.remoteTransport.relayUrl})` : ""}.`
      : "\nConnected directly.";
  }

  const badgeColor = !snap
    ? "gray"
    : status === "disconnected"
      ? "red"
      : status === "connecting"
        ? "amber"
        : mode === "remote"
          ? "green"
          : "gray";

  const icon =
    !snap ? (
      <GlobeIcon />
    ) : status === "disconnected" ? (
      <CrossCircledIcon />
    ) : status === "connecting" ? (
      <UpdateIcon />
    ) : (
      <GlobeIcon />
    );

  return (
    <Tooltip content={tooltip}>
      <IconButton
        variant="ghost"
        size="1"
        aria-label={summary}
        onClick={onOpenSettings}
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        <Badge
          color={badgeColor}
          variant="soft"
          radius="full"
          style={{ padding: "2px 6px" }}
        >
          {icon}
          {mode === "remote" && snap?.remoteHost ? (
            <span style={{ marginLeft: 4 }}>{snap.remoteHost}</span>
          ) : null}
          {isRelayed ? (
            <span
              style={{
                marginLeft: 5,
                paddingLeft: 5,
                borderLeft: "1px solid currentColor",
                opacity: 0.7,
                fontSize: "0.85em",
                letterSpacing: "0.02em",
              }}
            >
              Relayed
            </span>
          ) : null}
        </Badge>
      </IconButton>
    </Tooltip>
  );
}
