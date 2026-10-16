import { workspaceDirectoryAtom } from "../state/workspaceDirectoryAtom";
import { Alert, ScrollView } from "react-native";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { Provider, createStore } from "jotai";
import { installClientApi } from "@workspace/client-kit-native/host";
import {
  createFakeClientHost,
  type FakeClientHost,
} from "@workspace/client-kit-native/testing";
import { SettingsScreen } from "./SettingsScreen";
import { BrowserKitProvider } from "../state/BrowserKitProvider";
import { connectionStatusAtom } from "../state/connectionAtoms";
import { shellClientAtom } from "../state/shellClientAtom";
import {
  listMobileWorkspaces,
  mobileWorkspaceSelectionDependencies,
  selectMobileWorkspace,
} from "../services/workspaceSelection";

jest.mock("../services/workspaceSelection", () => ({
  listMobileWorkspaces: jest.fn(),
  mobileWorkspaceSelectionDependencies: jest.fn((control) => ({ control })),
  selectMobileWorkspace: jest.fn(),
}));

jest.mock("./WorkspaceConnectionsSection", () => ({
  WorkspaceConnectionsSection: () => null,
}));

jest.mock("./WorkspaceConnectionBar", () => ({
  WorkspaceConnectionBar: () => null,
}));

const listMock = listMobileWorkspaces as jest.MockedFunction<
  typeof listMobileWorkspaces
>;
const selectMock = selectMobileWorkspace as jest.MockedFunction<
  typeof selectMobileWorkspace
>;
const dependenciesMock =
  mobileWorkspaceSelectionDependencies as jest.MockedFunction<
    typeof mobileWorkspaceSelectionDependencies
  >;
let host: FakeClientHost;

const workspaces = [
  {
    workspaceId: "ws-a",
    name: "alpha",
    lastOpened: 10,
    pendingApprovalCount: 0,
    running: true,
  },
  {
    workspaceId: "ws-b",
    name: "beta",
    lastOpened: 5,
    pendingApprovalCount: 0,
    running: false,
  },
];

const profile = {
  userId: "usr_ada",
  handle: "ada",
  displayName: "Ada Lovelace",
  role: "member" as const,
  color: "#123abc",
  avatar: "data:image/png;base64,YXZhdGFy",
};

let settlePairing: (outcome: unknown) => void = () => undefined;

function renderSettings(section?: "devices" | "connection") {
  const store = createStore();
  store.set(connectionStatusAtom, "connected");
  const shellClient = {
    workspaceId: "ws-a",
    credentials: { deviceId: `dev_${"d".repeat(24)}` },
    hubControl: {
      listWorkspaces: jest.fn(),
      routeWorkspace: jest.fn(),
      pairDevice: jest.fn(async () => ({
        pairing: {
          code: "device-invite",
          pairUrl: "https://vibestudio.app/p#device-invite",
          expiresAt: Date.now() + 60_000,
        },
      })),
      awaitPairing: jest.fn(
        () =>
          new Promise((resolve) => {
            settlePairing = resolve;
          }),
      ),
    },
    dispose: jest.fn(),
    refreshAccountProfile: jest.fn(async () => profile),
    updateAccountProfile: jest.fn(async () => ({
      ...profile,
      handle: "ada-updated",
      displayName: "Ada Byron",
      color: "#abc",
      avatar: undefined,
    })),
  };
  store.set(shellClientAtom, shellClient as never);
  store.set(workspaceDirectoryAtom, {
    activeWorkspaceId: "ws-a",
    entries: workspaces,
    clearBrowserCookies: jest.fn(async () => undefined),
    dispose: jest.fn(async () => undefined),
  } as never);
  const navigation = { goBack: jest.fn(), replace: jest.fn() };
  return {
    ...render(
      <Provider store={store}>
        <BrowserKitProvider>
          <SettingsScreen
            navigation={navigation as never}
            route={{ params: { workspaceId: "ws-a", section } }}
          />
        </BrowserKitProvider>
      </Provider>,
    ),
    navigation,
    shellClient,
  };
}

describe("SettingsScreen workspace selector", () => {
  beforeEach(async () => {
    host = await createFakeClientHost({ granted: ["device-session", "clipboard"] });
    installClientApi(host.api);
    listMock.mockReset().mockResolvedValue(workspaces);
    selectMock.mockReset().mockResolvedValue({} as never);
    dependenciesMock.mockClear();
  });

  it.each(["devices", "connection"] as const)(
    "opens the requested %s section once layout is available",
    async (section) => {
      const scroll = jest.spyOn(ScrollView.prototype, "scrollTo");
      const view = renderSettings(section);
      fireEvent(view.getByTestId(`settings-section-${section}`), "layout", {
        nativeEvent: { layout: { x: 0, y: 420, width: 300, height: 30 } },
      });
      await waitFor(() =>
        expect(scroll).toHaveBeenCalledWith({ y: 420, animated: false }),
      );
      fireEvent.press(view.getByLabelText("Back"));
      expect(view.navigation.goBack).toHaveBeenCalledTimes(1);
      scroll.mockRestore();
    },
  );

  it("saves the current account profile and clears its avatar", async () => {
    const view = renderSettings();
    await waitFor(() =>
      expect(view.getByLabelText("Display name")).toBeTruthy(),
    );

    fireEvent.changeText(view.getByLabelText("Display name"), "Ada Byron");
    fireEvent.changeText(view.getByLabelText("Handle"), "ada-updated");
    fireEvent.changeText(view.getByLabelText("Profile color"), "#abc");
    fireEvent.press(view.getByLabelText("Clear avatar"));
    fireEvent.press(view.getByTestId("profile-save"));

    await waitFor(() =>
      expect(view.shellClient.updateAccountProfile).toHaveBeenCalledWith({
        displayName: "Ada Byron",
        handle: "ada-updated",
        color: "#abc",
        avatar: null,
      }),
    );
    expect(view.getByText("Profile saved.")).toBeTruthy();
  });

  it("offers no clipboard avatar paste: the host API cannot read the clipboard", async () => {
    const view = renderSettings();
    await waitFor(() =>
      expect(view.getByLabelText("Display name")).toBeTruthy(),
    );
    expect(view.queryByLabelText("Paste profile avatar")).toBeNull();
  });

  it("keeps the profile form usable when server validation rejects a save", async () => {
    const view = renderSettings();
    view.shellClient.updateAccountProfile.mockRejectedValueOnce(
      new Error('Handle "taken" is already taken'),
    );
    await waitFor(() => expect(view.getByLabelText("Handle")).toBeTruthy());

    fireEvent.changeText(view.getByLabelText("Handle"), "taken");
    fireEvent.press(view.getByTestId("profile-save"));

    await waitFor(() =>
      expect(view.getByText('Handle "taken" is already taken')).toBeTruthy(),
    );
    expect(view.getByLabelText("Handle").props.editable).toBe(true);
  });

  it("shows loading, current workspace, and the account-visible choices", async () => {
    let resolveList: ((value: typeof workspaces) => void) | undefined;
    listMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveList = resolve;
        }),
    );
    const view = renderSettings();

    expect(view.getByText("Loading workspaces…")).toBeTruthy();
    resolveList?.(workspaces);

    await waitFor(() =>
      expect(view.getByTestId("workspace-option-ws-a")).toBeTruthy(),
    );
    expect(view.getByText("Current workspace")).toBeTruthy();
    expect(view.getByText("Starts when selected")).toBeTruthy();
    expect(
      view.getByTestId("workspace-option-ws-a").props.accessibilityState,
    ).toMatchObject({
      selected: true,
      disabled: true,
    });
  });

  it("routes a non-current workspace and exposes the opening state", async () => {
    selectMock.mockImplementationOnce(() => new Promise(() => undefined));
    const view = renderSettings();
    await waitFor(() =>
      expect(view.getByTestId("workspace-option-ws-b")).toBeTruthy(),
    );

    fireEvent.press(view.getByTestId("workspace-option-ws-b"));

    expect(selectMock).toHaveBeenCalledWith(
      "ws-b",
      expect.objectContaining({
        control: expect.objectContaining({ activeWorkspaceId: "ws-a" }),
      }),
    );
    expect(view.getByText("Switching…")).toBeTruthy();
    expect(
      view.getByTestId("workspace-option-ws-b").props.accessibilityState,
    ).toMatchObject({
      busy: true,
      disabled: true,
    });
  });

  it("lets the first paired phone invite a desktop into the same workspace", async () => {
    const view = renderSettings();
    await waitFor(() => {
      expect(
        view.getByRole("button", { name: "Connect another device" }).props
          .accessibilityState,
      ).toMatchObject({ disabled: false });
    });

    fireEvent.press(
      view.getByRole("button", { name: "Connect another device" }),
    );

    await waitFor(() =>
      expect(view.shellClient.hubControl.pairDevice).toHaveBeenCalledWith(),
    );
    expect(
      view.getByText("https://vibestudio.app/p#device-invite"),
    ).toBeTruthy();

    fireEvent.press(view.getByText("Copy link"));
    await waitFor(() =>
      expect(host.callsOf("clipboard.setString")).toEqual([
        ["https://vibestudio.app/p#device-invite"],
      ]),
    );

    await waitFor(() =>
      expect(view.shellClient.hubControl.awaitPairing).toHaveBeenCalledWith({
        code: "device-invite",
      }),
    );
    await act(async () =>
      settlePairing({
        status: "paired",
        device: {
          deviceId: "dev_desktop",
          userId: "user-1",
          label: "Desktop",
          createdAt: 1,
        },
      }),
    );
    expect(await view.findByText("Paired Desktop")).toBeTruthy();
  });

  it("surfaces loading errors and retries in place", async () => {
    listMock
      .mockRejectedValueOnce(new Error("control reach unavailable"))
      .mockResolvedValueOnce(workspaces);
    const view = renderSettings();

    await waitFor(() =>
      expect(view.getByRole("alert").props.children).toBe(
        "control reach unavailable",
      ),
    );
    fireEvent.press(view.getByText("Retry"));

    await waitFor(() =>
      expect(view.getByTestId("workspace-option-ws-b")).toBeTruthy(),
    );
    expect(listMock).toHaveBeenCalledTimes(2);
  });

  it("asks the host to forget the pairing, then releases the live workspace", async () => {
    const alert = jest
      .spyOn(Alert, "alert")
      .mockImplementation(() => undefined);
    const view = renderSettings();
    await waitFor(() => expect(view.getByText("Disconnect")).toBeTruthy());

    fireEvent.press(view.getByText("Disconnect"));
    const confirmButtons = alert.mock.calls[0]?.[2] ?? [];
    await act(async () => {
      confirmButtons
        .find((button) => button.text === "Disconnect")
        ?.onPress?.();
    });

    await waitFor(() => expect(view.shellClient.dispose).toHaveBeenCalledTimes(1));
    expect(host.callsOf("device.reset")).toHaveLength(1);
    alert.mockRestore();
  });

  it("keeps the live workspace intact when the host cannot reset the device", async () => {
    host = await createFakeClientHost({
      granted: ["device-session"],
      handlers: {
        "device.reset": () => {
          throw new Error("the host could not clear the pairing");
        },
      },
    });
    installClientApi(host.api);
    const alert = jest
      .spyOn(Alert, "alert")
      .mockImplementation(() => undefined);
    const view = renderSettings();
    await waitFor(() => expect(view.getByText("Disconnect")).toBeTruthy());

    fireEvent.press(view.getByText("Disconnect"));
    const confirmButtons = alert.mock.calls[0]?.[2] ?? [];
    await act(async () => {
      confirmButtons
        .find((button) => button.text === "Disconnect")
        ?.onPress?.();
    });

    await waitFor(() =>
      expect(alert.mock.calls[1]?.[0]).toBe("Could not disconnect securely"),
    );
    expect(alert.mock.calls[1]?.[1]).toBe("the host could not clear the pairing");
    expect(view.shellClient.dispose).not.toHaveBeenCalled();
    alert.mockRestore();
  });
});
