// @vitest-environment jsdom
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
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
}));
vi.mock("../shell/workspaceContext", () => ({
  useShellWorkspaceClient: () => ({ problemReports: mocks }),
}));
vi.mock("../shell/useShellOverlay", () => ({ useShellOverlay: mocks.overlay }));
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

it("requires an independent local-server choice after the device choice and never silently enables either", async () => {
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
    name: "Enable local server reports",
  });
  expect(mocks.decideServer).not.toHaveBeenCalled();
  expect(screen.getByRole("dialog")).toBeTruthy();
  fireEvent.click(serverEnable);
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(mocks.decide).toHaveBeenCalledWith(0, "off");
  expect(mocks.decideServer).toHaveBeenCalledWith(0, "on");
  expect(mocks.send).not.toHaveBeenCalled();
});
