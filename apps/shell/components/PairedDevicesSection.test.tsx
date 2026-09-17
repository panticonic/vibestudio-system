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

const api = vi.hoisted(() => ({ createPanel: vi.fn() }));
vi.mock("../shell/workspaceContext", () => ({
  useShellWorkspaceClient: () => ({
    panel: { createPanel: api.createPanel },
    hubControl: { listDevices: async () => ({ devices: [] }) },
    account: { resolveProfiles: async () => ({}) },
    remoteCred: {},
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
