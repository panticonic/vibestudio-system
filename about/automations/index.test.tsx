// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { Theme } from "@radix-ui/themes";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  observeChanges: vi.fn(),
  overview: vi.fn(),
}));

vi.mock("@workspace/runtime", () => ({
  missions: {
    observeChanges: fixture.observeChanges,
    overview: fixture.overview,
  },
  openPanel: vi.fn(),
  panel: { stateArgs: { get: () => ({}) } },
  rpc: { call: vi.fn() },
}));

vi.mock("@workspace/agentic-chat", () => ({
  AutomationActivity: () => null,
  AutomationParametersEditor: () => null,
  CronScheduleDisplay: () => null,
  createAutomationUiClient: () => ({}),
}));

vi.mock("@workspace/about-shared/ui", () => ({
  AboutThemeRoot: ({ children }: { children: ReactNode }) => <Theme>{children}</Theme>,
  AboutPage: ({
    children,
    actions,
  }: {
    children: ReactNode;
    actions?: ReactNode;
  }) => (
    <main>
      {actions}
      {children}
    </main>
  ),
}));

import AutomationsPanelRoot from "./index.js";

describe("Automations panel observation lifecycle", () => {
  beforeEach(() => {
    fixture.observeChanges.mockReset();
    fixture.overview.mockReset();
    let observationAttempt = 0;
    fixture.observeChanges.mockImplementation(({ signal }: { signal: AbortSignal }) => {
      observationAttempt += 1;
      if (observationAttempt === 1)
        return Promise.reject(new Error("Mission observation disconnected"));
      if (observationAttempt === 2) return Promise.resolve({ version: "version-1" });
      return new Promise((_, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    });
    fixture.overview.mockResolvedValue({
      generatedAt: 1,
      stats: { total: 0, active: 0, running: 0, issueRunsLast24Hours: 0, completed: 0 },
      items: [],
      attention: [],
    });
  });

  it("settles initial loading and lets the user retry after observation fails", async () => {
    render(<AutomationsPanelRoot />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Mission observation disconnected");
    expect(screen.queryByText("Loading automation overview…")).toBeNull();
    expect(
      (screen.getByRole("button", { name: "Refresh automations" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
    expect(fixture.overview).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() => expect(fixture.overview).toHaveBeenCalledOnce());
    expect(screen.getByText("No automations yet")).toBeTruthy();
    expect(fixture.observeChanges).toHaveBeenCalledTimes(3);
  });

  it("retains the observation version across an in-flight snapshot", async () => {
    let release!: () => void;
    const firstSnapshot = new Promise<void>(resolve => { release = resolve; });
    const snapshot = { generatedAt: 1, stats: { total: 0, active: 0, running: 0, issueRunsLast24Hours: 0, completed: 0 }, items: [], attention: [] };
    fixture.overview.mockImplementationOnce(async () => { await firstSnapshot; return snapshot; });
    fixture.observeChanges.mockImplementation(({ afterVersion, signal }: { afterVersion?: string; signal: AbortSignal }) => {
      if (afterVersion === undefined) return Promise.resolve({ version: "version-1" });
      if (afterVersion === "version-1") return Promise.resolve({ version: "version-2" });
      return new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
    });
    const mounted = render(<AutomationsPanelRoot />);
    await waitFor(() => expect(fixture.overview).toHaveBeenCalledOnce());
    expect(fixture.observeChanges).toHaveBeenCalledOnce();
    release();
    await waitFor(() => expect(fixture.overview).toHaveBeenCalledTimes(2));
    expect(fixture.observeChanges).toHaveBeenNthCalledWith(2, { afterVersion: "version-1", signal: expect.any(AbortSignal) });
    expect(fixture.observeChanges).toHaveBeenNthCalledWith(3, { afterVersion: "version-2", signal: expect.any(AbortSignal) });
    mounted.unmount();
  });

  it("retires only the active observation when the panel is unmounted", async () => {
    fixture.observeChanges.mockImplementation(({ afterVersion, signal }: { afterVersion?: string; signal: AbortSignal }) => afterVersion === undefined ? Promise.resolve({ version: "version-1" }) : new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true })));
    const mounted = render(<AutomationsPanelRoot />);
    await waitFor(() => expect(fixture.observeChanges).toHaveBeenCalledTimes(2));
    const signal = fixture.observeChanges.mock.calls[1]![0].signal as AbortSignal;
    expect(signal.aborted).toBe(false);
    mounted.unmount();
    expect(signal.aborted).toBe(true);
    expect(fixture.overview).toHaveBeenCalledOnce();
  });
});
