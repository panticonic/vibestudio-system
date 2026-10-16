// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceConnectionState } from "@vibestudio/shared/workspaceConnection";

import { WorkspaceConnectionNotice } from "./WorkspaceConnectionNotice";

const client = vi.hoisted(() => ({
  reconnectNow: vi.fn<() => Promise<void>>(),
  relaunch: vi.fn<() => Promise<void>>(),
}));
vi.mock("../shell/workspaceContext", () => ({
  useShellWorkspaceClient: () => ({ remoteCred: client }),
}));

describe("WorkspaceConnectionNotice", () => {
  let listener: ((state: WorkspaceConnectionState) => void) | null;
  const state = (
    phase: WorkspaceConnectionState["phase"],
    extra: Partial<WorkspaceConnectionState> = {},
  ): WorkspaceConnectionState => ({
    version: 1,
    phase,
    mode: "remote",
    since: 1,
    ...extra,
  });

  beforeEach(() => {
    vi.useFakeTimers();
    listener = null;
    client.reconnectNow.mockReset().mockResolvedValue(undefined);
    client.relaunch.mockReset().mockResolvedValue(undefined);
    Object.assign(globalThis, {
      __vibestudioWorkspaceConnection: {
        getCurrent: vi.fn(async () => state("online")),
        onChange: vi.fn((next: (value: WorkspaceConnectionState) => void) => {
          listener = next;
          return () => {
            listener = null;
          };
        }),
      },
    });
  });

  afterEach(() => {
    delete (globalThis as { __vibestudioWorkspaceConnection?: unknown })
      .__vibestudioWorkspaceConnection;
    vi.useRealTimers();
  });

  it("delays a transient outage, preserves the desktop, and offers recovery", async () => {
    const onOpenSettings = vi.fn();
    render(<WorkspaceConnectionNotice onOpenSettings={onOpenSettings} />);
    await act(async () => Promise.resolve());

    act(() =>
      listener?.(state("reconnecting", { attempt: 3, nextRetryInMs: 1_500 })),
    );
    expect(screen.queryByRole("status")).toBeNull();
    act(() => vi.advanceTimersByTime(350));

    expect(
      screen.getByRole("status", { name: "Workspace server unavailable" }),
    ).toBeTruthy();
    expect(screen.getByText("Reconnect attempt 3 in 2s")).toBeTruthy();
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Retry now" })),
    );
    expect(client.reconnectNow).toHaveBeenCalledOnce();
    fireEvent.click(
      screen.getByRole("button", { name: "Connection settings" }),
    );
    expect(onOpenSettings).toHaveBeenCalledOnce();

    act(() => listener?.(state("online")));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows a terminal session end immediately and can restart", async () => {
    render(<WorkspaceConnectionNotice onOpenSettings={vi.fn()} />);
    await act(async () => Promise.resolve());
    act(() => listener?.(state("ended")));

    expect(
      screen.getByRole("alert", { name: "Connection ended" }),
    ).toBeTruthy();
    await act(async () =>
      fireEvent.click(
        screen.getByRole("button", { name: "Restart Vibestudio" }),
      ),
    );
    expect(client.relaunch).toHaveBeenCalledOnce();
  });
});
