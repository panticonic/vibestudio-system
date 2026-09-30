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
  decide: vi.fn(),
  send: vi.fn(),
  shellEvent: vi.fn(),
  accept: vi.fn(),
}));
vi.mock("../shell/workspaceContext", () => ({
  useShellWorkspaceClient: () => ({ problemReports: mocks }),
}));
vi.mock("../shell/useShellOverlay", () => ({ useShellOverlay: vi.fn() }));
vi.mock("../shell/useShellEvent", () => ({ useShellEvent: mocks.shellEvent }));
import {
  useReportingSetup,
  ReportingFirstUse,
  useReportingReady,
} from "./ProblemReporting";
import type { ShellWorkspaceClient } from "../shell/workspaceClient";
const decision = {
  state: "undecided",
  revision: 0,
  policy: "problem-reporting.v2",
  decidedAt: null,
  pseudonym: null,
};
function Review() {
  const setup = useReportingSetup(
    mocks as unknown as ShellWorkspaceClient["problemReports"],
    true,
  );
  return (
    <Theme>
      <h1>Review workspace units</h1>
      {setup.content}
      <button
        onClick={() =>
          void (async () => {
            if (setup.required) await setup.save();
            mocks.accept();
          })()
        }
      >
        Accept workspace
      </button>
      <button>Cancel</button>
    </Theme>
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.consent.mockResolvedValue(decision);
  mocks.serverConsent.mockResolvedValue(decision);
  mocks.decide.mockImplementation(async (revision, state) => ({
    ...decision,
    revision: revision + 1,
    state,
  }));
  mocks.decideServer.mockImplementation(async (revision, state) => ({
    ...decision,
    revision: revision + 1,
    state,
  }));
});
afterEach(cleanup);
describe("reporting inside initial workspace review", () => {
  it("uses one unchecked choice, creates no dialog, and saves off with review acceptance", async () => {
    render(<Review />);
    const checkbox = await screen.findByRole("checkbox");
    await waitFor(() => expect(checkbox.hasAttribute("disabled")).toBe(false));
    expect(checkbox.getAttribute("aria-checked")).toBe("false");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mocks.decide).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Accept workspace" }));
    await waitFor(() => expect(mocks.accept).toHaveBeenCalledOnce());
    expect(mocks.decide).toHaveBeenCalledWith(0, "off");
    expect(mocks.decideServer).toHaveBeenCalledWith(0, "off");
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("saves explicit opt-in for both previously undecided scopes before acceptance", async () => {
    render(<Review />);
    const checkbox = await screen.findByRole("checkbox");
    await waitFor(() => expect(checkbox.hasAttribute("disabled")).toBe(false));
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole("button", { name: "Accept workspace" }));
    await waitFor(() => expect(mocks.accept).toHaveBeenCalledOnce());
    expect(mocks.decide).toHaveBeenCalledWith(0, "on");
    expect(mocks.decideServer).toHaveBeenCalledWith(0, "on");
    expect(mocks.decideServer.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.accept.mock.invocationCallOrder[0]!,
    );
  });
  it("does not persist a checkbox edit when the review is cancelled", async () => {
    render(<Review />);
    const checkbox = await screen.findByRole("checkbox");
    await waitFor(() => expect(checkbox.hasAttribute("disabled")).toBe(false));
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(mocks.decide).not.toHaveBeenCalled();
    expect(mocks.decideServer).not.toHaveBeenCalled();
  });
  it("shows saved choices as the default in another workspace without overwriting different device/server preferences", async () => {
    mocks.consent.mockResolvedValue({ ...decision, state: "off", revision: 1 });
    mocks.serverConsent.mockResolvedValue({
      ...decision,
      state: "on",
      revision: 1,
    });
    render(<Review />);
    await waitFor(() =>
      expect(screen.getByRole("checkbox").getAttribute("aria-checked")).toBe(
        "mixed",
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Accept workspace" }));
    await waitFor(() => expect(mocks.accept).toHaveBeenCalledOnce());
    expect(mocks.decide).not.toHaveBeenCalled();
    expect(mocks.decideServer).not.toHaveBeenCalled();
  });
  it("an explicit audit edit changes the shared device and server choices", async () => {
    mocks.consent.mockResolvedValue({ ...decision, state: "off", revision: 1 });
    render(<Review />);
    const checkbox = await screen.findByRole("checkbox");
    await waitFor(() => expect(checkbox.hasAttribute("disabled")).toBe(false));
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole("button", { name: "Accept workspace" }));
    await waitFor(() => expect(mocks.accept).toHaveBeenCalledOnce());
    expect(mocks.decide).toHaveBeenCalledWith(1, "on");
    expect(mocks.decideServer).toHaveBeenCalledWith(0, "on");
  });
  it("supports a device-only connection", async () => {
    mocks.serverConsent.mockResolvedValue(null);
    render(<Review />);
    const checkbox = await screen.findByRole("checkbox");
    await waitFor(() => expect(checkbox.hasAttribute("disabled")).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Accept workspace" }));
    await waitFor(() => expect(mocks.accept).toHaveBeenCalledOnce());
    expect(mocks.decide).toHaveBeenCalledWith(0, "off");
    expect(mocks.decideServer).not.toHaveBeenCalled();
  });
  it("recovers an unavailable server inside the review on reconnect", async () => {
    mocks.serverConsent.mockRejectedValueOnce(new Error("Disconnected"));
    render(<Review />);
    await screen.findByRole("alert");
    expect(screen.queryByRole("dialog")).toBeNull();
    const handler = mocks.shellEvent.mock.calls.find(
      ([name]) => name === "server-connection-changed",
    )![1];
    await act(async () => {
      handler({ status: "connected" });
    });
    await waitFor(() =>
      expect(screen.getByRole("checkbox").hasAttribute("disabled")).toBe(false),
    );
    expect(mocks.decide).not.toHaveBeenCalled();
  });
});

function GatedAudit() {
  const ready = useReportingReady();
  return ready ? <Review /> : null;
}
describe("one separate first-start prompt followed by the unit audit", () => {
  it("makes one combined decision before opening the audit, which defaults to the saved choice", async () => {
    let device = { ...decision };
    let server = { ...decision };
    mocks.consent.mockImplementation(async () => device);
    mocks.serverConsent.mockImplementation(async () => server);
    mocks.decide.mockImplementation(
      async (_revision, state) =>
        (device = { ...device, state, revision: device.revision + 1 }),
    );
    mocks.decideServer.mockImplementation(
      async (_revision, state) =>
        (server = { ...server, state, revision: server.revision + 1 }),
    );
    const view = render(
      <Theme>
        <ReportingFirstUse>
          <GatedAudit />
        </ReportingFirstUse>
      </Theme>,
    );
    const button = await screen.findByRole("button", {
      name: "Enable automatic reports",
    });
    await waitFor(() => expect(button.hasAttribute("disabled")).toBe(false));
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.queryByRole("checkbox")).toBeNull();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.click(button);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() =>
      expect(screen.getByRole("checkbox").getAttribute("aria-checked")).toBe(
        "true",
      ),
    );
    expect(mocks.decide).toHaveBeenCalledWith(0, "on");
    expect(mocks.decideServer).toHaveBeenCalledWith(0, "on");
    view.unmount();
    render(
      <Theme>
        <ReportingFirstUse>
          <GatedAudit />
        </ReportingFirstUse>
      </Theme>,
    );
    await waitFor(() =>
      expect(screen.getByRole("checkbox").getAttribute("aria-checked")).toBe(
        "true",
      ),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mocks.decide).toHaveBeenCalledOnce();
    expect(mocks.decideServer).toHaveBeenCalledOnce();
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it("does not flash the first-start dialog while loading a saved choice", async () => {
    let finish!: (value: typeof decision) => void;
    mocks.consent.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    mocks.consent.mockResolvedValue({ ...decision, state: "on", revision: 1 });
    mocks.serverConsent.mockResolvedValue({
      ...decision,
      state: "on",
      revision: 1,
    });
    render(
      <Theme>
        <ReportingFirstUse>
          <GatedAudit />
        </ReportingFirstUse>
      </Theme>,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
    await act(async () => {
      finish({ ...decision, state: "on", revision: 1 });
    });
    await waitFor(() =>
      expect(screen.getByRole("checkbox").getAttribute("aria-checked")).toBe(
        "true",
      ),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("does not create a second prompt for an undecided server after the device decision is saved", async () => {
    mocks.consent.mockResolvedValue({ ...decision, state: "on", revision: 1 });
    mocks.serverConsent.mockResolvedValue(decision);
    render(
      <Theme>
        <ReportingFirstUse>
          <GatedAudit />
        </ReportingFirstUse>
      </Theme>,
    );
    await waitFor(() =>
      expect(screen.getByRole("checkbox").getAttribute("aria-checked")).toBe(
        "true",
      ),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Accept workspace" }));
    await waitFor(() => expect(mocks.accept).toHaveBeenCalledOnce());
    expect(mocks.decide).not.toHaveBeenCalled();
    expect(mocks.decideServer).toHaveBeenCalledWith(0, "on");
  });
});
