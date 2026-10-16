// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceConnectionState } from "@vibestudio/shared/workspaceConnection";
import type { ConnectionPort } from "@workspace/connection-core";
import { ConnectionNotice } from "./ConnectionNotice";

const state = (
  phase: WorkspaceConnectionState["phase"],
  extra: Partial<WorkspaceConnectionState> = {},
): WorkspaceConnectionState => ({ version: 1, phase, mode: "remote", since: 1, ...extra });

describe("ConnectionNotice", () => {
  let listener: ((state: WorkspaceConnectionState) => void) | null;
  const port = {
    current: vi.fn(async () => state("online")),
    onChange: vi.fn((next: (value: WorkspaceConnectionState) => void) => {
      listener = next;
      return () => {
        listener = null;
      };
    }),
    reconnectNow: vi.fn<() => Promise<void>>(),
    relaunch: vi.fn<() => Promise<void>>(),
  } satisfies ConnectionPort;

  beforeEach(() => {
    vi.useFakeTimers();
    listener = null;
    port.reconnectNow.mockReset().mockResolvedValue(undefined);
    port.relaunch.mockReset().mockResolvedValue(undefined);
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("holds back a transient outage, then offers retry and settings", async () => {
    const onOpenSettings = vi.fn();
    render(<ConnectionNotice port={port} onOpenSettings={onOpenSettings} />);
    await act(async () => Promise.resolve());

    act(() => listener?.(state("reconnecting", { attempt: 3, nextRetryInMs: 1_500 })));
    expect(screen.queryByRole("status")).toBeNull();
    act(() => vi.advanceTimersByTime(350));
    expect(screen.getByRole("status", { name: "Workspace server unavailable" })).toBeTruthy();
    expect(screen.getByText("Reconnect attempt 3 in 2s")).toBeTruthy();

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Retry now" })));
    expect(port.reconnectNow).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Connection settings" }));
    expect(onOpenSettings).toHaveBeenCalledOnce();

    act(() => listener?.(state("online")));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows a final session end at once and recovers by relaunching", async () => {
    render(<ConnectionNotice port={port} onOpenSettings={vi.fn()} />);
    await act(async () => Promise.resolve());
    act(() => listener?.(state("ended")));

    expect(screen.getByRole("alert", { name: "Connection ended" })).toBeTruthy();
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Restart Vibestudio" })),
    );
    expect(port.relaunch).toHaveBeenCalledOnce();
    expect(port.reconnectNow).not.toHaveBeenCalled();
  });

  it("says why a recovery failed and clears it on the next attempt", async () => {
    render(<ConnectionNotice port={port} onOpenSettings={vi.fn()} />);
    await act(async () => Promise.resolve());
    act(() => listener?.(state("ended")));
    port.relaunch.mockRejectedValueOnce(new Error("Error: Could not restart"));

    const restart = () =>
      act(async () =>
        fireEvent.click(screen.getByRole("button", { name: "Restart Vibestudio" })),
      );
    await restart();
    expect(screen.getByText("Could not restart")).toBeTruthy();
    await restart();
    expect(screen.queryByText("Could not restart")).toBeNull();
  });
});
