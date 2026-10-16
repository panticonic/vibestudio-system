// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { Theme } from "@radix-ui/themes";
import { afterEach, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  createPanel: vi.fn(),
  listDevices: vi.fn(async () => ({ devices: [] as unknown[] })),
  pairDevice: vi.fn(),
  awaitPairing: vi.fn(),
}));
vi.mock("../shell/workspaceContext", () => ({
  useShellWorkspaceClient: () => ({
    panel: { createPanel: api.createPanel },
    hubControl: {
      listDevices: api.listDevices,
      pairDevice: api.pairDevice,
      awaitPairing: api.awaitPairing,
    },
    account: { resolveProfiles: async () => ({}) },
  }),
}));
import { PairedDevicesSection } from "./PairedDevicesSection";

afterEach(cleanup);

it("keeps failed phone setup visible and allows retry without duplicate launches", async () => {
  let rejectLaunch!: (error: Error) => void;
  api.createPanel.mockReturnValueOnce(
    new Promise((_resolve, reject) => {
      rejectLaunch = reject;
    }),
  );
  const onStart = vi.fn();
  render(
    <Theme>
      <PairedDevicesSection onStartPhoneSetup={onStart} />
    </Theme>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Set up a phone" }));
  const starting = screen.getByRole("button", { name: "Starting setup…" });
  expect((starting as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(starting);
  expect(api.createPanel).toHaveBeenCalledTimes(1);
  rejectLaunch(new Error("Connection interrupted"));
  await screen.findByText(
    "Could not start phone setup: Connection interrupted",
  );
  expect(onStart).not.toHaveBeenCalled();
  api.createPanel.mockResolvedValueOnce({});
  fireEvent.click(screen.getByRole("button", { name: "Set up a phone" }));
  await waitFor(() => expect(onStart).toHaveBeenCalledTimes(1));
  expect(screen.queryByText(/Could not start phone setup/)).toBeNull();
});

it("shows the paired device when the hub settles the invite's lifecycle", async () => {
  const code = "A".repeat(21) + "A";
  api.pairDevice.mockResolvedValueOnce({
    userId: "user-1",
    handle: "me",
    pairing: {
      code,
      pairUrl: `https://vibestudio.app/p#${code}`,
      expiresAt: Date.now() + 60_000,
      serverId: "srv_test",
    },
  });
  let settle!: (outcome: unknown) => void;
  api.awaitPairing.mockReturnValueOnce(
    new Promise((resolve) => {
      settle = resolve;
    }),
  );
  render(
    <Theme>
      <PairedDevicesSection />
    </Theme>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Connect a device" }));
  await screen.findByText("Waiting for device...");
  expect(api.awaitPairing).toHaveBeenCalledWith({ code });
  const listCalls = api.listDevices.mock.calls.length;
  settle({
    status: "paired",
    device: {
      deviceId: "dev_phone",
      userId: "user-1",
      label: "Phone",
      createdAt: 1,
    },
  });
  await screen.findByText("Paired Phone");
  await waitFor(() =>
    expect(api.listDevices.mock.calls.length).toBe(listCalls + 1),
  );
});

it("shows the invite as expired only when the hub reports it ended unredeemed", async () => {
  const code = "B".repeat(22);
  api.pairDevice.mockResolvedValueOnce({
    userId: "user-1",
    handle: "me",
    pairing: {
      code,
      pairUrl: `https://vibestudio.app/p#${code}`,
      expiresAt: Date.now() - 1,
      serverId: "srv_test",
    },
  });
  let settle!: (outcome: unknown) => void;
  api.awaitPairing.mockReturnValueOnce(
    new Promise((resolve) => {
      settle = resolve;
    }),
  );
  render(
    <Theme>
      <PairedDevicesSection />
    </Theme>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Connect a device" }));
  await screen.findByText("Waiting for device...");
  settle({ status: "expired" });
  await screen.findByText("Expired");
  expect(screen.getByRole("button", { name: "Regenerate" })).toBeTruthy();
});
