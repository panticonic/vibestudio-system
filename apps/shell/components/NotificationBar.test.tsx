// @vitest-environment jsdom

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { Theme } from "@radix-ui/themes";
import { createStore, Provider } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  EventName,
  EventPayloads,
  NotificationPayload,
} from "@vibestudio/shared/events";

const shellClient = vi.hoisted(() => ({
  applyUpdate: vi.fn(() => Promise.resolve({ applied: true })),
  rollback: vi.fn(() => Promise.resolve()),
  restart: vi.fn(() => Promise.resolve()),
  recoverExecution: vi.fn(() => Promise.resolve()),
  createPanel: vi.fn(() => Promise.resolve({ id: "automations" })),
  show: vi.fn(() => Promise.resolve("notif")),
  reportAction: vi.fn(() => Promise.resolve()),
  dismiss: vi.fn(() => Promise.resolve()),
}));

vi.mock("../shell/client", () => ({
  browserEnvironment: { openDownload: vi.fn(), revealDownload: vi.fn() },
  extensions: { invoke: vi.fn() },
  app: {
    applyUpdate: shellClient.applyUpdate,
  },
  notification: {
    show: shellClient.show,
    reportAction: shellClient.reportAction,
    dismiss: shellClient.dismiss,
  },
  supervisedUnits: {
    rollback: shellClient.rollback,
    restart: shellClient.restart,
    recoverExecution: shellClient.recoverExecution,
  },
  panel: {
    createPanel: shellClient.createPanel,
  },
}));

vi.mock("../shell/useShellEvent", () => ({
  useShellEvent: vi.fn(),
}));
vi.mock("../shell/useDirectShellEvent", () => ({
  useDirectShellEvent: vi.fn(),
}));

import { useShellEvent } from "../shell/useShellEvent";
import { useDirectShellEvent } from "../shell/useDirectShellEvent";
import { NotificationBar } from "./NotificationBar";
import { WorkspaceNavigationHostContext } from "../shell/workspaceContext";
import { commandAgentRequestAtom } from "../state/commandAgentAtoms";

function renderBar() {
  const store = createStore();
  const view = render(
    <Provider store={store}>
      <Theme>
        <NotificationBar />
      </Theme>
    </Provider>,
  );
  return { store, ...view };
}

function emitShellEvent<E extends EventName>(
  event: E,
  payload: EventPayloads[E],
) {
  const callback = vi
    .mocked(useShellEvent)
    .mock.calls.find(([registeredEvent]) => registeredEvent === event)?.[1] as
    | ((payload: EventPayloads[E]) => void)
    | undefined;
  expect(callback).toBeTruthy();
  act(() => {
    callback?.(payload);
  });
}

function emitDirectShellEvent<E extends EventName>(
  event: E,
  payload: EventPayloads[E],
) {
  const callback = vi
    .mocked(useDirectShellEvent)
    .mock.calls.find(([registeredEvent]) => registeredEvent === event)?.[1] as
    | ((payload: EventPayloads[E]) => void)
    | undefined;
  expect(callback).toBeTruthy();
  act(() => {
    callback?.(payload);
  });
}

describe("NotificationBar", () => {
  beforeEach(() => {
    vi.mocked(useShellEvent).mockClear();
    vi.mocked(useDirectShellEvent).mockClear();
    shellClient.applyUpdate.mockClear();
    shellClient.rollback.mockClear();
    shellClient.restart.mockClear();
    shellClient.recoverExecution.mockClear();
    shellClient.createPanel.mockClear();
    shellClient.show.mockClear();
    shellClient.reportAction.mockClear();
    shellClient.dismiss.mockClear();
  });

  it("opens a repair chat with the full collapsed diagnostics and preserves the error", () => {
    const { store } = renderBar();
    const payload: NotificationPayload = {
      id: "failed-publication",
      type: "error",
      title: "Workspace update failed",
      sourcePanelId: "panel:onboarding",
      message: "Typecheck failed\n" + "diagnostic evidence\n".repeat(300),
      details: [{ label: "Diagnostic 2", value: "Property roster is missing" }],
      history: [
        {
          title: "Previous attempt",
          message: "Original failure",
          timestamp: 1,
        },
      ],
    };
    emitShellEvent("notification:show", payload);
    expect(screen.queryByTestId("notification-details-pane")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Fix with AI" }));

    const request = store.get(commandAgentRequestAtom);
    expect(request).toMatchObject({
      mode: "quickfire",
      panelId: "panel:onboarding",
    });
    const evidence = JSON.parse(
      request!.prompt!.split("Notification details:\n\n")[1]!,
    );
    expect(evidence).toMatchObject(payload);
    expect(request!.prompt!.length).toBeGreaterThan(4_000);
    expect(screen.getByText("Workspace update failed")).toBeTruthy();
    expect(shellClient.reportAction).not.toHaveBeenCalled();
  });

  it("offers repair chat for errors while leaving routine notifications alone", () => {
    renderBar();
    emitShellEvent("notification:show", {
      id: "saved",
      type: "success",
      title: "Saved",
      ttl: 0,
    });
    expect(screen.queryByRole("button", { name: "Fix with AI" })).toBeNull();
  });

  it("shows a background workspace notification in the visible host and keeps its action", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const focus = vi.fn();
    const store = createStore();
    const view = render(
      <Provider store={store}>
        <WorkspaceNavigationHostContext.Provider
          value={{
            element: null,
            scrollElement: null,
            titleBarHost: null,
            notificationHost: host,
            setNotificationHost: vi.fn(),
            workspaceId: "personal",
            workspaceLabel: "Personal",
            workspaceNames: { personal: "Personal", system: "System" },
            sidebarVisible: true,
            toggleSidebar: vi.fn(),
            closeSidebar: vi.fn(),
            focus,
          }}
        >
          <div hidden>
            <NotificationBar />
          </div>
        </WorkspaceNavigationHostContext.Provider>
      </Provider>,
    );
    try {
      emitDirectShellEvent("notification:show", {
        id: "personal-job",
        type: "info",
        title: "Your job finished",
        ttl: 0,
        actions: [
          {
            id: "open-result",
            label: "Open result",
            command: { type: "panel.open", source: "panels/chat" },
          },
        ],
      });
      expect(host.textContent).toContain("Your job finished");
      expect(view.container.textContent).not.toContain("Your job finished");
      fireEvent.click(
        screen.getByRole("button", { name: "Personal · Open workspace" }),
      );
      expect(focus).toHaveBeenCalledOnce();
      fireEvent.click(screen.getByRole("button", { name: "Open result" }));
      await waitFor(() =>
        expect(shellClient.reportAction).toHaveBeenCalledWith(
          "personal-job",
          "open-result",
        ),
      );
      expect(shellClient.createPanel).toHaveBeenCalledWith("panels/chat", {
        focus: true,
        stateArgs: undefined,
      });
      emitDirectShellEvent("notification:show", {
        id: "personal-error",
        type: "error",
        title: "Personal workspace failed",
        sourcePanelId: "personal-panel",
      });
      fireEvent.click(screen.getByRole("button", { name: "Fix with AI" }));
      expect(focus).toHaveBeenCalledTimes(2);
      expect(store.get(commandAgentRequestAtom)).toMatchObject({
        mode: "quickfire",
        panelId: "personal-panel",
      });
      expect(host.textContent).toContain("Personal workspace failed");
    } finally {
      view.unmount();
      host.remove();
    }
  });

  it("renders notifications addressed directly to the authenticated account", () => {
    renderBar();

    emitDirectShellEvent("notification:show", {
      id: "account-only",
      type: "info",
      title: "Account notification",
      message: "This was not a watched broadcast.",
    });

    expect(screen.getByText("Account notification")).toBeTruthy();
    expect(document.querySelector(".shell-notification-strip")).toBeTruthy();
  });

  it("auto-dismisses a transient processing notice at its explicit TTL", async () => {
    let dismissAtTtl: (() => void) | undefined;
    const realSetTimeout = window.setTimeout.bind(window);
    const captureDismiss = ((handler: TimerHandler, timeout?: number) => {
      if (timeout === 6_000 && typeof handler === "function") {
        dismissAtTtl = handler as () => void;
        return 1;
      }
      return realSetTimeout(handler, timeout);
    }) as typeof window.setTimeout;
    const setTimeout = vi
      .spyOn(window, "setTimeout")
      .mockImplementation(captureDismiss);
    try {
      renderBar();
      emitDirectShellEvent("notification:show", {
        id: "mission-processing",
        type: "info",
        title: "Running Daily summary",
        message: "Scheduled wake-up #4 is being processed.",
        ttl: 6_000,
      });

      expect(screen.getByText("Running Daily summary")).toBeTruthy();
      expect(dismissAtTtl).toBeTypeOf("function");
      act(() => dismissAtTtl?.());
      expect(screen.queryByText("Running Daily summary")).toBeNull();
      await waitFor(() =>
        expect(shellClient.reportAction).toHaveBeenCalledWith(
          "mission-processing",
          "dismiss",
        ),
      );
    } finally {
      setTimeout.mockRestore();
    }
  });

  it("opens a notification's exact automation deep link", async () => {
    renderBar();
    emitDirectShellEvent("notification:show", {
      id: "mission-processing",
      type: "info",
      title: "Running Daily summary",
      ttl: 6_000,
      actions: [
        {
          id: "view-automation",
          label: "View automation",
          command: {
            type: "panel.open",
            source: "about/automations",
            stateArgs: { missionId: "msn_daily" },
          },
        },
      ],
    });

    fireEvent.click(screen.getByRole("button", { name: "View automation" }));
    await waitFor(() =>
      expect(shellClient.createPanel).toHaveBeenCalledWith(
        "about/automations",
        {
          focus: true,
          stateArgs: { missionId: "msn_daily" },
        },
      ),
    );
  });

  it("expands bounded diagnostic details and all recorded errors", () => {
    renderBar();

    const payload: NotificationPayload = {
      id: "extension-crash",
      type: "error",
      title: "Extension stopped",
      message:
        "@workspace-extensions/react-native failed 5 times and will not restart until reloaded.",
      details: [
        {
          label: "Extension",
          value: "@workspace-extensions/react-native",
          mono: true,
        },
        { label: "Attempts", value: "5" },
        {
          label: "Latest error",
          value: "Cannot find module typedServiceClient.js",
          mono: true,
        },
      ],
      history: [
        {
          title: "Attempt 1",
          message: "First crash\nstack line 1",
          timestamp: 1,
        },
        {
          title: "Attempt 2",
          message: "Second crash\nstack line 2",
          timestamp: 2,
        },
      ],
    };

    emitShellEvent("notification:show", payload);

    expect(screen.getByText("Extension stopped")).toBeTruthy();
    expect(screen.getByText(payload.message!)).toBeTruthy();
    expect(screen.queryByText("First crash")).toBeNull();

    fireEvent.click(screen.getByText("Details"));

    expect(screen.getByText("Extension")).toBeTruthy();
    expect(screen.getByText("@workspace-extensions/react-native")).toBeTruthy();
    expect(screen.getByText("Latest error")).toBeTruthy();
    expect(
      screen.getByText("Cannot find module typedServiceClient.js"),
    ).toBeTruthy();
    expect(screen.getByText("Recent errors")).toBeTruthy();
    expect(screen.getByText(/Attempt 1/)).toBeTruthy();
    expect(screen.getByText(/Attempt 2/)).toBeTruthy();
    expect(screen.getByText(/First crash/)).toBeTruthy();
    expect(screen.getByText(/Second crash/)).toBeTruthy();

    const detailsPane = screen.getByTestId("notification-details-pane");
    expect(detailsPane.style.maxHeight).toBe("280px");
    expect(detailsPane.style.overflowY).toBe("auto");
  });

  it("shows queued notifications in the expanded panel instead of hiding them", () => {
    renderBar();

    emitShellEvent("notification:show", {
      id: "older",
      type: "error",
      title: "Older extension error",
      message: "Older failure",
    });
    emitShellEvent("notification:show", {
      id: "newer",
      type: "error",
      title: "Newest extension error",
      message: "Newest failure",
      details: [{ label: "Extension", value: "@workspace-extensions/newer" }],
    });

    expect(screen.getByText("Newest extension error")).toBeTruthy();
    expect(screen.getByText("+1")).toBeTruthy();
    expect(screen.queryByText("Older extension error")).toBeNull();

    fireEvent.click(screen.getByText("Details"));

    expect(screen.getByText("Other notifications")).toBeTruthy();
    expect(screen.getByText("Older extension error")).toBeTruthy();
    expect(screen.getByText("Older failure")).toBeTruthy();
  });

  it("executes an exact runtime recovery action with its stale-action guard", async () => {
    renderBar();
    const digest = "a".repeat(64);
    emitShellEvent("notification:show", {
      id: "runtime-recovery",
      type: "error",
      title: "Runtime execution unavailable",
      actions: [
        {
          id: "restore-exact-execution",
          label: "Restore exact execution",
          command: {
            type: "runtime.execution.recover",
            entityId: "do:workers/agent:Agent:one",
            expectedExecutionDigest: digest,
            strategy: "restore-exact",
          },
        },
      ],
    });

    fireEvent.click(screen.getByText("Restore exact execution"));

    await waitFor(() => {
      expect(shellClient.recoverExecution).toHaveBeenCalledWith(
        "do:workers/agent:Agent:one",
        digest,
        "restore-exact",
      );
    });
  });
});
