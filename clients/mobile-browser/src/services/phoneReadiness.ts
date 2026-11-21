import type { WorkspaceReadiness } from "../state/connectionAtoms.js";
import type { ConnectionStatus } from "./mobileTransport.js";

type VisiblePhoneWorkspace = {
  state: "opening" | "ready" | "failed";
  readiness: WorkspaceReadiness;
  transport: ConnectionStatus;
  error?: string | null;
};

/** Project readiness from the visible workspace and its reconciled session. */
export function workspacePhoneReadiness(
  session: VisiblePhoneWorkspace | undefined,
): {
  status: "opening" | "ready" | "failed";
  message: string;
} {
  if (!session)
    return {
      status: "opening",
      message: "Opening your workspace on the phone…",
    };
  const readiness = session.readiness;
  if (session.state === "failed" || readiness === "failed") {
    return {
      status: "failed",
      message:
        session.error ??
        "The phone could not prepare the workspace. Check the message on your phone.",
    };
  }
  if (
    session.state === "ready" &&
    session.transport === "connected" &&
    readiness === "reconciled"
  ) {
    return {
      status: "ready",
      message:
        "Your workspace is ready on the phone. You can unplug the USB cable.",
    };
  }
  return {
    status: "opening",
    message:
      "Preparing your workspace. Keep the phone open and respond to any approval shown there.",
  };
}
