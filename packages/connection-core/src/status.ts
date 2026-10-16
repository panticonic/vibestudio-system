import {
  workspaceConnectionPresentation,
  type WorkspaceConnectionPresentation,
  type WorkspaceConnectionState,
  type WorkspaceTransportStatus,
} from "@vibestudio/shared/workspaceConnection";

/**
 * How available the workspace server is, in the one vocabulary every client
 * surface speaks. Three runtimes learn about it three ways (the desktop host's
 * availability bridge, the mobile transport's status plus device reachability,
 * the terminal host's connection state); each is normalized to this view before
 * anything is drawn.
 */
export type ConnectionPhase =
  | "starting"
  | "online"
  | "reconnecting"
  /** The transport is down and no attempt is in flight (the server is unreachable); it will retry. */
  | "disconnected"
  /** The session can no longer resume. */
  | "ended";

export interface ConnectionView {
  phase: ConnectionPhase;
  /** Whether the connection has ever been up, to tell "connecting" from "reconnecting". */
  everOnline: boolean;
  /** The device has no network link at all (only meaningful while the transport is not up). */
  offline?: boolean;
  attempt?: number;
  nextRetryInMs?: number;
  /** Why it is down, when the transport said. */
  reason?: string;
}

export type ConnectionTone = "ok" | "pending" | "problem";

/** One status line: a sentence-case label, an optional parenthetical, and how loud it is. */
export interface ConnectionStatusLine {
  tone: ConnectionTone;
  label: string;
  detail?: string;
}

/** A desktop host availability record, as the view. */
export function viewFromWorkspaceConnection(state: WorkspaceConnectionState): ConnectionView {
  return {
    phase: state.phase,
    everOnline: state.phase === "online" || state.phase === "reconnecting" || state.phase === "ended",
    ...(state.attempt === undefined ? {} : { attempt: state.attempt }),
    ...(state.nextRetryInMs === undefined ? {} : { nextRetryInMs: state.nextRetryInMs }),
    ...(state.reason === undefined ? {} : { reason: state.reason }),
  };
}

/**
 * A raw transport status, as the view. `everOnline` is the caller's memory
 * (`ConnectionTracker` keeps it): a transport that connects, drops and connects
 * again is "reconnecting", a transport that never connected is "connecting".
 */
export function viewFromTransport(input: {
  status: WorkspaceTransportStatus;
  everOnline: boolean;
  networkReachable?: boolean;
  attempt?: number;
  reason?: string;
}): ConnectionView {
  const base = {
    everOnline: input.everOnline,
    ...(input.attempt === undefined ? {} : { attempt: input.attempt }),
    ...(input.reason === undefined ? {} : { reason: input.reason }),
  };
  if (input.status === "connected") return { ...base, phase: "online", everOnline: true };
  const offline = input.networkReachable === false;
  return {
    ...base,
    phase:
      input.status === "disconnected"
        ? "disconnected"
        : input.everOnline
          ? "reconnecting"
          : "starting",
    ...(offline ? { offline: true } : {}),
  };
}

/** The terminal host's own connection state, as the view. */
export function viewFromTerminalConnection(state: {
  phase: "connected" | "reconnecting" | "lost";
  cause?: string;
}): ConnectionView {
  const reason =
    state.cause ??
    (state.phase === "reconnecting"
      ? "connection interrupted"
      : state.phase === "lost"
        ? "server gone"
        : undefined);
  return {
    phase: state.phase === "connected" ? "online" : state.phase === "lost" ? "ended" : "reconnecting",
    everOnline: true,
    ...(reason === undefined ? {} : { reason }),
  };
}

/**
 * The compact status line for a bar or a status row.
 *
 * A live pipe is reachable by definition and is never overridden by a device
 * "no internet" signal (a LAN-only server shows as connected). "No network" is
 * said only when there is genuinely no link and the pipe is not up.
 */
export function connectionStatusLine(view: ConnectionView): ConnectionStatusLine {
  switch (view.phase) {
    case "online":
      return { tone: "ok", label: "Connected" };
    case "ended":
    case "disconnected":
      if (view.offline) return { tone: "problem", label: "No network" };
      return {
        tone: "problem",
        label: "Disconnected",
        ...(view.reason ? { detail: view.reason } : {}),
      };
    case "starting":
      if (view.offline) return { tone: "problem", label: "No network" };
      return { tone: "pending", label: "Connecting…" };
    case "reconnecting":
      if (view.offline) return { tone: "problem", label: "No network" };
      return {
        tone: "pending",
        label: "Reconnecting…",
        ...(view.reason ? { detail: view.reason } : {}),
      };
  }
}

/** One sentence describing the server connection, for settings and tooltips. */
export function connectionSentence(input: {
  view: ConnectionView;
  isRemote: boolean;
  remoteHost?: string;
}): string {
  const { view, isRemote, remoteHost } = input;
  switch (view.phase) {
    case "ended":
    case "disconnected":
      return `Disconnected from ${isRemote ? `remote server ${remoteHost ?? ""}`.trim() : "local server"}`;
    case "starting":
    case "reconnecting":
      return `${view.everOnline ? "Reconnecting to server" : "Connecting to server"}${
        view.attempt ? ` (attempt ${view.attempt})` : ""
      }…`;
    case "online":
      return isRemote ? `Connected to ${remoteHost ?? "remote server"}` : "Connected locally";
  }
}

/**
 * The notice a person is told about an outage: what happened, whether anything
 * can be done, and whether this is final (`ended`: the session can no longer
 * resume, restarting is the only way back). `null` while nothing is wrong.
 */
export interface ConnectionNotice extends WorkspaceConnectionPresentation {
  /** True once the session cannot resume; recovery is a relaunch, not a retry. */
  final: boolean;
}

export function connectionNotice(state: WorkspaceConnectionState): ConnectionNotice | null {
  const presentation = workspaceConnectionPresentation(state);
  return presentation ? { ...presentation, final: state.phase === "ended" } : null;
}
