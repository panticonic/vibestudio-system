// @vitest-environment jsdom
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { Theme } from "@radix-ui/themes";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const host = vi.hoisted(() => ({
  listWorkspaces: vi.fn(),
  openWorkspace: vi.fn(),
  setBrowserDataSurface: vi.fn(),
  events: new Map<string, (payload: any) => void>(),
}));
vi.mock("../shell/workspaceContext", () => {
  const client = {
    hubControl: { listWorkspaces: host.listWorkspaces },
    view: { setBrowserDataSurface: host.setBrowserDataSurface },
  };
  return {
    useWorkspaceVisible: () => true,
    useShellWorkspaceClient: () => client,
  };
});
vi.mock("../shell/nativePanelPresentation", () => ({
  desktopNativePanelBridge: () => ({ openWorkspace: host.openWorkspace }),
}));
vi.mock("../shell/useShellEvent", () => ({
  useShellEvent: (event: string, handler: (payload: any) => void) => {
    host.events.set(event, handler);
  },
}));
import { BrowserDataSection } from "./BrowserDataSection";

const catalog = [
  { workspaceId: "system", name: "System", privateRole: "system" },
  { workspaceId: "personal", name: "Personal", privateRole: "personal" },
];

beforeEach(() => {
  host.listWorkspaces.mockReset().mockResolvedValue(catalog);
  host.openWorkspace.mockReset().mockResolvedValue(undefined);
  host.setBrowserDataSurface.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    x: 20,
    y: 30,
    left: 20,
    top: 30,
    right: 620,
    bottom: 430,
    width: 600,
    height: 400,
    toJSON: () => ({}),
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const show = (workspaceId?: string) =>
  render(
    <Theme>
      <BrowserDataSection workspaceId={workspaceId} section="passwords" />
    </Theme>,
  );

describe("Browser data Settings", () => {
  it("selects Personal by role and gives the host only its scope, section and geometry", async () => {
    const rendered = show();
    await waitFor(() =>
      expect(host.setBrowserDataSurface).toHaveBeenCalledWith({
        workspaceId: "personal",
        section: "passwords",
        dark: false,
        bounds: { x: 20, y: 30, width: 600, height: 400 },
      }),
    );
    expect(host.openWorkspace).toHaveBeenCalledWith("personal");
    fireEvent.focus(screen.getByLabelText("Enter browser data"));
    await waitFor(() =>
      expect(host.setBrowserDataSurface).toHaveBeenLastCalledWith(
        expect.objectContaining({ focus: "first" }),
      ),
    );
    rendered.rerender(
      <Theme>
        <BrowserDataSection section="autofill" />
      </Theme>,
    );
    await waitFor(() =>
      expect(host.setBrowserDataSurface).toHaveBeenLastCalledWith(
        expect.objectContaining({ section: "autofill" }),
      ),
    );
    expect(
      host.setBrowserDataSurface.mock.calls.some(
        ([options]) => options === null,
      ),
    ).toBe(false);
    rendered.unmount();
    await waitFor(() =>
      expect(host.setBrowserDataSurface).toHaveBeenLastCalledWith(null),
    );
  });

  it("rejects a System target instead of showing another workspace's browser data", async () => {
    show("system");
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Personal workspace",
    );
    expect(host.openWorkspace).not.toHaveBeenCalled();
    expect(host.setBrowserDataSurface).not.toHaveBeenCalled();
  });

  it("awaits workspace readiness and does not mount when Settings close during opening", async () => {
    let ready!: () => void;
    host.openWorkspace.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          ready = resolve;
        }),
    );
    const rendered = show("personal");
    await waitFor(() =>
      expect(host.openWorkspace).toHaveBeenCalledWith("personal"),
    );
    expect(host.setBrowserDataSurface).not.toHaveBeenCalled();
    rendered.unmount();
    await act(async () => ready());
    expect(host.setBrowserDataSurface).not.toHaveBeenCalled();
  });

  it("joins a pending presentation before closing so it cannot reopen after unmount", async () => {
    let complete!: () => void;
    host.setBrowserDataSurface.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          complete = resolve;
        }),
    );
    const rendered = show("personal");
    await waitFor(() =>
      expect(host.setBrowserDataSurface).toHaveBeenCalledOnce(),
    );
    rendered.unmount();
    expect(host.setBrowserDataSurface).toHaveBeenCalledOnce();
    await act(async () => complete());
    await waitFor(() =>
      expect(host.setBrowserDataSurface).toHaveBeenLastCalledWith(null),
    );
  });
});
