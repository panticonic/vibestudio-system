// @vitest-environment jsdom
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
  act,
} from "@testing-library/react";
import { Theme } from "@radix-ui/themes";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
const mocks = vi.hoisted(() => ({
  consent: vi.fn(),
  serverConsent: vi.fn(),
  decideServer: vi.fn(),
  availability: vi.fn(),
  decide: vi.fn(),
  send: vi.fn(),
  overlay: vi.fn(),
  shellEvent: vi.fn(),
}));
vi.mock("../shell/workspaceContext", () => ({
  useShellWorkspaceClient: () => ({ problemReports: mocks }),
}));
vi.mock("../shell/useShellOverlay", () => ({ useShellOverlay: mocks.overlay }));
vi.mock("../shell/useShellEvent", () => ({ useShellEvent: mocks.shellEvent }));
import { ReportingFirstUse } from "./ProblemReporting";
const decision = {
  state: "undecided",
  revision: 0,
  policy: "problem-reporting.v2",
  decidedAt: null,
  pseudonym: null,
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.consent.mockResolvedValue(decision);
  mocks.serverConsent.mockResolvedValue(null);
  mocks.decideServer.mockImplementation(async (revision, state) => ({
    ...decision,
    revision: revision + 1,
    state,
  }));
  mocks.availability.mockResolvedValue({ configured: false });
  mocks.decide.mockImplementation(async (revision, state) => ({
    ...decision,
    revision: revision + 1,
    state,
  }));
});
afterEach(cleanup);
describe("mandatory first reporting choice", () => {
  it("offers equal explicit choices, resists dismissal, and enrollment alone never sends", async () => {
    render(
      <Theme>
        <ReportingFirstUse />
      </Theme>,
    );
    const enable = await screen.findByRole("button", {
      name: "Enable automatic reports",
    });
    const off = screen.getByRole("button", {
      name: "Keep automatic reports off",
    });
    expect(enable.getAttribute("data-accent-color")).toBe(
      off.getAttribute("data-accent-color"),
    );
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(mocks.decide).not.toHaveBeenCalled();
    fireEvent.click(off);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(mocks.decide).toHaveBeenCalledWith(0, "off");
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("does not prompt again after a persisted choice", async () => {
    mocks.consent.mockResolvedValue({ ...decision, state: "off", revision: 1 });
    render(
      <Theme>
        <ReportingFirstUse />
      </Theme>,
    );
    await waitFor(() => expect(mocks.consent).toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("shows a retry when preference loading fails and cannot silently bypass the required decision", async () => {
    mocks.consent.mockRejectedValueOnce(new Error("Disconnected"));
    render(
      <Theme>
        <ReportingFirstUse />
      </Theme>,
    );
    const retry = await screen.findByRole("button", { name: "Retry" });
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: "Enable automatic reports",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    fireEvent.click(retry);
    await waitFor(() =>
      expect(
        (
          screen.getByRole("button", {
            name: "Enable automatic reports",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false),
    );
  });
});

it("requires an independent connected-server choice after the device choice and never silently enables either", async () => {
  mocks.serverConsent.mockResolvedValue(decision);
  render(
    <Theme>
      <ReportingFirstUse />
    </Theme>,
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Keep automatic reports off" }),
  );
  const serverEnable = await screen.findByRole("button", {
    name: "Enable server reports",
  });
  expect(mocks.decideServer).not.toHaveBeenCalled();
  expect(screen.getByRole("dialog")).toBeTruthy();
  fireEvent.click(serverEnable);
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(mocks.decide).toHaveBeenCalledWith(0, "off");
  expect(mocks.decideServer).toHaveBeenCalledWith(0, "on");
  expect(mocks.send).not.toHaveBeenCalled();
});

it("prompts for a newly connected headless server even when the device already opted out", async () => {
  mocks.consent.mockResolvedValue({ ...decision, state: "off", revision: 1 });
  mocks.serverConsent.mockResolvedValue(decision);
  render(
    <Theme>
      <ReportingFirstUse />
    </Theme>,
  );
  const off = await screen.findByRole("button", {
    name: "Keep server reports off",
  });
  expect(
    screen.getByText(
      "Sharing choice for your account on the connected server.",
    ),
  ).toBeTruthy();
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  expect(screen.getByRole("dialog")).toBeTruthy();
  fireEvent.click(off);
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(mocks.decideServer).toHaveBeenCalledWith(0, "off");
  expect(mocks.decide).not.toHaveBeenCalled();
  expect(mocks.send).not.toHaveBeenCalled();
});

it("does not repeat a saved server choice when opening another workspace", async () => {
  mocks.consent.mockResolvedValue({ ...decision, state: "off", revision: 1 });
  mocks.serverConsent.mockResolvedValue({
    ...decision,
    state: "on",
    revision: 2,
  });
  const first = render(
    <Theme>
      <ReportingFirstUse />
    </Theme>,
  );
  await waitFor(() => expect(mocks.serverConsent).toHaveBeenCalledTimes(1));
  first.unmount();
  render(
    <Theme>
      <ReportingFirstUse />
    </Theme>,
  );
  await waitFor(() => expect(mocks.serverConsent).toHaveBeenCalledTimes(2));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(mocks.decideServer).not.toHaveBeenCalled();
});

it("loads the mandatory server choice after an initially unavailable headless server reconnects", async () => {
  mocks.consent.mockResolvedValue({ ...decision, state: "off", revision: 1 });
  mocks.serverConsent.mockRejectedValueOnce(new Error("Disconnected"));
  mocks.serverConsent.mockResolvedValue(decision);
  render(
    <Theme>
      <ReportingFirstUse />
    </Theme>,
  );
  await screen.findByText(
    "Server reporting choice unavailable: Error: Disconnected",
  );
  const connectionChanged = mocks.shellEvent.mock.calls.at(-1)![1];
  await act(async () =>
    connectionChanged({ status: "connected", isRemote: true }),
  );
  await screen.findByRole("button", { name: "Keep server reports off" });
  expect(screen.getByRole("dialog")).toBeTruthy();
  expect(mocks.serverConsent).toHaveBeenCalledTimes(2);
  expect(mocks.decideServer).not.toHaveBeenCalled();
});
