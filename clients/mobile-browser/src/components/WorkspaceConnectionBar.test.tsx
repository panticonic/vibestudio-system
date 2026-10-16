import { Alert } from "react-native";
import { act, fireEvent, render } from "@testing-library/react-native";
import { Provider, createStore } from "jotai";
import { BrowserKitProvider } from "../state/BrowserKitProvider";
import {
  connectionStatusAtom,
  networkReachableAtom,
} from "../state/connectionAtoms";
import { shellClientAtom } from "../state/shellClientAtom";
import { WorkspaceConnectionBar } from "./WorkspaceConnectionBar";

function renderBar(store: ReturnType<typeof createStore>) {
  return render(
    <Provider store={store}>
      <BrowserKitProvider>
        <WorkspaceConnectionBar onRepair={jest.fn()} />
      </BrowserKitProvider>
    </Provider>,
  );
}

describe("WorkspaceConnectionBar", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    act(() => {
      jest.runAllTimers();
    });
    jest.useRealTimers();
  });

  it("feeds the transport's status, reachability and reconnect progress into the bar", () => {
    const store = createStore();
    let progress: ((value: { attempt: number }) => void) | undefined;
    store.set(connectionStatusAtom, "connected");
    store.set(shellClientAtom, {
      transport: {
        reconnect: jest.fn(),
        onReconnectProgress: (listener: (value: { attempt: number }) => void) => {
          progress = listener;
          return jest.fn();
        },
      },
    } as never);

    const view = renderBar(store);
    expect(view.queryByRole("button")).toBeNull();

    act(() => {
      store.set(connectionStatusAtom, "connecting");
      progress?.({ attempt: 3 });
    });
    expect(view.getByText(/attempt 3/i)).toBeTruthy();

    act(() => {
      store.set(connectionStatusAtom, "connected");
    });
    act(() => {
      store.set(connectionStatusAtom, "disconnected");
      store.set(networkReachableAtom, false);
    });
    expect(view.getByText("No network — tap for options")).toBeTruthy();
  });

  it("reconnects through the shell client's transport", () => {
    const store = createStore();
    const reconnect = jest.fn();
    store.set(connectionStatusAtom, "disconnected");
    store.set(shellClientAtom, {
      transport: { reconnect, onReconnectProgress: () => jest.fn() },
    } as never);
    const alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);

    const view = renderBar(store);
    act(() => {
      jest.runAllTimers();
    });
    fireEvent.press(view.getByRole("button"));
    const buttons = alertSpy.mock.calls[0]?.[2] as { text?: string; onPress?: () => void }[];
    buttons.find((button) => button.text === "Reconnect")?.onPress?.();
    expect(reconnect).toHaveBeenCalledTimes(1);
    alertSpy.mockRestore();
  });
});
