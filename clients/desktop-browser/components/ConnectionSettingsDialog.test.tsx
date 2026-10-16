// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";
import { Theme } from "@radix-ui/themes";
import { describe, expect, it, vi } from "vitest";
import { incomingPairLink } from "../shell/client";

vi.mock("../shell/client", () => ({
  app: {
    getInfo: vi.fn(async () => ({
      connectionMode: "remote",
      connectionStatus: "connected",
    })),
  },
  incomingPairLink: { onLink: vi.fn(() => () => undefined) },
  remoteCred: {
    getCurrent: vi.fn(async () => ({
      connected: true,
      configured: true,
      isActive: true,
      deviceId: "device-1",
      workspaceName: "home",
    })),
    pair: vi.fn(),
    reconnectNow: vi.fn(),
    clear: vi.fn(),
    relaunch: vi.fn(),
  },
}));
vi.mock("../shell/useShellOverlay", () => ({ useShellOverlay: vi.fn() }));
vi.mock("../shell/useShellEvent", async () => {
  const { useShellEventFixture } = await import("../test/shellEventFixture");
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  return {
    useShellEvent: vi.fn(
      (
        event: string,
        callback: (payload: unknown) => void,
        readSnapshot?: (signal: AbortSignal) => void | Promise<void>
      ) => useShellEventFixture(listeners, event, callback, readSnapshot)
    ),
  };
});
vi.mock("./PairedDevicesSection", () => ({
  PairedDevicesSection: () => <div>Device access settings</div>,
}));
vi.mock("./AppUpdatesSection", () => ({
  AppUpdatesSection: () => <div>Workspace app settings</div>,
}));
vi.mock("./AccountProfileSection", () => ({
  AccountProfileSection: () => <div>Account profile settings</div>,
}));
vi.mock("./ThemeSettings", () => ({
  ThemeSettingsControls: () => <div>Appearance settings</div>,
}));
vi.mock("./TemplatesSection", () => ({
  TemplatesSection: () => <div>Template settings</div>,
}));
vi.mock("./WorkspaceConnectionsSection", () => ({
  WorkspaceConnectionsSection: () => <div>Workspace connection settings</div>,
}));

const { ConnectionSettingsDialog } = await import("./ConnectionSettingsDialog");

describe("ConnectionSettingsDialog", () => {
  it("keeps pairing-link admission mounted while optional settings content is closed", () => {
    const onSectionChange = vi.fn();
    render(
      <Theme>
        <ConnectionSettingsDialog section={null} onSectionChange={onSectionChange} />
      </Theme>,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    const apply = vi.mocked(incomingPairLink.onLink).mock.lastCall?.[0];
    if (!apply) throw new Error("Pairing-link listener is not mounted");
    act(() => apply({
      endpointId: "ab".repeat(32),
      relays: ["https://relay.example.test/"],
      code: "A".repeat(22),
      v: 5,
    }));
    expect(onSectionChange).toHaveBeenCalledWith("connection");
  });

  it("keeps replacement pairing out of the active connection's happy path", async () => {
    render(
      <Theme>
        <ConnectionSettingsDialog
          section="connection"
          onSectionChange={vi.fn()}
        />
      </Theme>,
    );

    expect(
      await screen.findByText(
        /Currently connected to your server \(device device-1\)/i,
      ),
    ).toBeTruthy();
    expect(screen.queryByLabelText("Pairing link")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /different server/i }));

    expect(screen.getByLabelText("Pairing link")).toBeTruthy();
    expect(
      screen.getByText(/replaces this device's saved connection/i),
    ).toBeTruthy();
  });

  it("renders every addressable settings view independently", async () => {
    const onSectionChange = vi.fn();
    const renderDialog = (
      section:
        | "connection"
        | "workspaces"
        | "devices"
        | "profile"
        | "appearance"
        | "apps"
        | "templates",
    ) => (
      <Theme>
        <ConnectionSettingsDialog
          section={section}
          onSectionChange={onSectionChange}
        />
      </Theme>
    );
    const { rerender } = render(renderDialog("connection"));

    expect(
      await screen.findByText(
        /Currently connected to your server \(device device-1\)/i,
      ),
    ).toBeTruthy();
    expect(screen.queryByText("Device access settings")).toBeNull();

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Devices" }), {
      button: 0,
      ctrlKey: false,
    });
    expect(onSectionChange).toHaveBeenCalledWith("devices");
    rerender(renderDialog("devices"));
    expect(await screen.findByText("Device access settings")).toBeTruthy();
    expect(
      screen.queryByText(
        /Currently connected to your server \(device device-1\)/i,
      ),
    ).toBeNull();

    rerender(renderDialog("workspaces"));
    expect(await screen.findByText("Workspace connection settings")).toBeTruthy();

    rerender(renderDialog("profile"));
    expect(await screen.findByText("Account profile settings")).toBeTruthy();
    rerender(renderDialog("appearance"));
    expect(await screen.findByText("Appearance settings")).toBeTruthy();
    rerender(renderDialog("apps"));
    expect(await screen.findByText("Workspace app settings")).toBeTruthy();
    rerender(renderDialog("templates"));
    expect(await screen.findByText("Template settings")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close settings" }));
    expect(onSectionChange).toHaveBeenCalledWith(null);
  });
});
