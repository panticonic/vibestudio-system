import { Alert } from "react-native";
import { act, fireEvent, render } from "@testing-library/react-native";
import { createConnectionTracker } from "@workspace/connection-core";
import { ConnectionBar } from "./ConnectionBar";
import { KitTestProvider } from "../testing/KitTestProvider";

type AlertButton = { text?: string; onPress?: () => void };

function renderBar(
  tracker: ReturnType<typeof createConnectionTracker>,
  props: Partial<React.ComponentProps<typeof ConnectionBar>> = {},
) {
  return render(
    <ConnectionBar tracker={tracker} onReconnect={jest.fn()} {...props} />,
    { wrapper: KitTestProvider },
  );
}

describe("ConnectionBar", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    act(() => {
      jest.runAllTimers();
    });
    jest.useRealTimers();
  });

  it("offers reconnect and re-pair when disconnected", () => {
    const onReconnect = jest.fn();
    const onRepair = jest.fn();
    const tracker = createConnectionTracker();
    tracker.transport("disconnected");

    const alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    const { getByRole } = renderBar(tracker, { onReconnect, onRepair });

    act(() => {
      jest.runAllTimers();
    });

    fireEvent.press(getByRole("button"));

    expect(alertSpy).toHaveBeenCalledTimes(1);
    const buttons = (alertSpy.mock.calls[0]?.[2] ?? []) as AlertButton[];
    expect(buttons.map((button) => button.text)).toEqual([
      "Reconnect",
      "Re-pair device",
      "Cancel",
    ]);

    buttons.find((button) => button.text === "Reconnect")?.onPress?.();
    expect(onReconnect).toHaveBeenCalledTimes(1);

    buttons.find((button) => button.text === "Re-pair device")?.onPress?.();
    expect(onRepair).toHaveBeenCalledTimes(1);

    alertSpy.mockRestore();
  });

  it("omits re-pair and offers only reconnect when disconnected and offline", () => {
    const tracker = createConnectionTracker();
    tracker.transport("disconnected");
    tracker.networkReachable(false);

    const alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    const { getByRole, getByText } = renderBar(tracker);

    act(() => {
      jest.runAllTimers();
    });

    expect(getByText("No network — tap for options")).toBeTruthy();
    fireEvent.press(getByRole("button"));
    expect(alertSpy.mock.calls[0]?.[0]).toBe("No network");
    const buttons = (alertSpy.mock.calls[0]?.[2] ?? []) as AlertButton[];
    expect(buttons.map((button) => button.text)).toEqual(["Reconnect", "Cancel"]);

    alertSpy.mockRestore();
  });

  it("stays actionable and shows reconnect attempt progress while connecting", () => {
    const tracker = createConnectionTracker();
    tracker.transport("connected");
    const view = renderBar(tracker, { onRepair: jest.fn() });

    act(() => {
      tracker.transport("connecting");
      tracker.reconnectProgress({ attempt: 3 });
    });

    expect(view.getByRole("button")).toBeTruthy();
    expect(view.getByText(/attempt 3/i)).toBeTruthy();
  });

  it("treats a live pipe as connected even when the device reports no internet (LAN-only)", () => {
    // A home server on Wi-Fi without internet is reachable over a direct path:
    // a connected status must NOT be overridden with a red "No network" bar.
    const tracker = createConnectionTracker();
    tracker.transport("connected");
    tracker.networkReachable(false);

    const { queryByRole } = renderBar(tracker);

    expect(queryByRole("button")).toBeNull();
  });

  it("is not interactive when connected and online", () => {
    const tracker = createConnectionTracker();
    tracker.transport("connected");
    tracker.networkReachable(true);

    const { queryByRole } = renderBar(tracker);

    act(() => {
      jest.runAllTimers();
    });

    expect(queryByRole("button")).toBeNull();
  });

  it("offers a setup retry when the connection is live but the workspace failed to set up", () => {
    const onRetrySetup = jest.fn();
    const tracker = createConnectionTracker();
    tracker.transport("connected");

    const alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    const { getByRole, getByText } = renderBar(tracker, {
      readiness: "failed",
      onRetrySetup,
    });

    expect(getByText("Workspace setup needs attention — tap to retry")).toBeTruthy();
    fireEvent.press(getByRole("button"));
    const buttons = (alertSpy.mock.calls[0]?.[2] ?? []) as AlertButton[];
    expect(buttons.map((button) => button.text)).toEqual(["Retry setup", "Cancel"]);
    buttons[0]?.onPress?.();
    expect(onRetrySetup).toHaveBeenCalledTimes(1);

    alertSpy.mockRestore();
  });
});
