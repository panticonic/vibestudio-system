// @vitest-environment jsdom
import React from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PaneContent } from "./PaneContent";

const state = vi.hoisted(() => ({
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
  getLocalPresentation: vi.fn(),
  directOn: vi.fn(),
  listeners: new Map<string, (value: unknown) => void>(),
}));
vi.mock("../shell/client", () => ({
  panel: { getLocalPresentation: state.getLocalPresentation },
  view: { forwardMouseClick: vi.fn() },
  events: {
    subscribe: state.subscribe,
    unsubscribe: state.unsubscribe,
    on: (event: string, listener: (value: unknown) => void) => {
      state.listeners.set(event, listener);
      return () => state.listeners.delete(event);
    },
  },
  directEvents: { on: state.directOn },
}));
vi.mock("./PanelSurface", () => ({
  PanelSurface: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));
const panelId = "panel:tree/chat";
const topic = "panel-local-presentation-changed";
const failure = {
  revision: 2,
  presentation: {
    state: "failed",
    slotId: panelId,
    message: "No matching export: createMdxComponents",
  },
};
function mount() {
  return render(
    <PaneContent
      paneId="chat"
      panelId={panelId}
      resident
      focused
      layoutEpoch={1}
      unresponsive={false}
      onDismissUnresponsive={() => {}}
      onFocusPane={() => {}}
    />,
  );
}
beforeEach(() => {
  state.listeners.clear();
  state.subscribe.mockReset().mockResolvedValue(undefined);
  state.unsubscribe.mockReset().mockResolvedValue(undefined);
  state.getLocalPresentation.mockReset().mockResolvedValue({
    revision: 1,
    presentation: { state: "idle", slotId: panelId },
  });
  state.directOn.mockReset();
});
afterEach(cleanup);

it("surfaces a watched host failure after the initial idle query", async () => {
  mount();
  await waitFor(() =>
    expect(state.getLocalPresentation).toHaveBeenCalledOnce(),
  );
  await act(async () => {
    state.listeners.get(topic)?.(failure);
  });
  expect(screen.getByText("Panel failed to load")).toBeTruthy();
  expect(screen.getByText(failure.presentation.message)).toBeTruthy();
  expect(screen.queryByText("Loading panel...")).toBeNull();
  expect(state.subscribe).toHaveBeenCalledWith(topic);
  expect(state.directOn).not.toHaveBeenCalled();
});

it("reads the held failure after watch opening so a pre-subscription failure is not lost", async () => {
  let open!: () => void;
  state.subscribe.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        open = resolve;
      }),
  );
  mount();
  expect(state.getLocalPresentation).not.toHaveBeenCalled();
  state.getLocalPresentation.mockResolvedValue(failure);
  await act(async () => {
    open();
  });
  expect(screen.getByText(failure.presentation.message)).toBeTruthy();
});

it("does not overwrite a newer failure event with an older query result", async () => {
  let finish!: (value: unknown) => void;
  state.getLocalPresentation.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  mount();
  await waitFor(() =>
    expect(state.getLocalPresentation).toHaveBeenCalledOnce(),
  );
  await act(async () => {
    state.listeners.get(topic)?.(failure);
  });
  await act(async () => {
    finish({ revision: 1, presentation: { state: "idle", slotId: panelId } });
  });
  expect(screen.getByText(failure.presentation.message)).toBeTruthy();
});
