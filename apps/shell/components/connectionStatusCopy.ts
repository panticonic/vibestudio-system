export type ConnectionStatus = "connected" | "connecting" | "disconnected";

/** One sentence describing the server connection, shared by chrome and settings. */
export function connectionStatusCopy({
  status,
  isRemote,
  remoteHost,
  hasConnected,
  attempt,
}: {
  status: ConnectionStatus;
  isRemote: boolean;
  remoteHost?: string;
  hasConnected: boolean;
  attempt?: number;
}): string {
  switch (status) {
    case "disconnected":
      return `Disconnected from ${isRemote ? `remote server ${remoteHost ?? ""}`.trim() : "local server"}`;
    case "connecting":
      return `${hasConnected ? "Reconnecting to server" : "Connecting to server"}${
        attempt ? ` (attempt ${attempt})` : ""
      }…`;
    case "connected":
      return isRemote
        ? `Connected to ${remoteHost ?? "remote server"}`
        : "Connected locally";
  }
}
