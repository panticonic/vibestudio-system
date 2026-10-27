// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  NavigationProvider,
  useNavigation,
  useNavigationActions,
} from "./NavigationContext";

function ModeProbe() {
  const { mode } = useNavigation();
  return <div data-testid="mode">{mode}</div>;
}

function NavigationProbe({ handler }: { handler: ReturnType<typeof vi.fn> }) {
  const { navigateToId, registerNavigateToId } = useNavigation();
  useEffect(
    () => registerNavigateToId(handler),
    [handler, registerNavigateToId],
  );
  return <button onClick={() => navigateToId("panel-child")}>Navigate</button>;
}

function ActionsRenderProbe({
  rendered,
}: {
  rendered: ReturnType<typeof vi.fn>;
}) {
  rendered();
  useNavigationActions();
  return null;
}

function renderMode() {
  render(
    <NavigationProvider>
      <ModeProbe />
    </NavigationProvider>,
  );

  return screen.getByTestId("mode").textContent;
}

beforeEach(() => {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === "(max-width: 767px)" ? false : false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    onchange: null,
    dispatchEvent: vi.fn(),
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("NavigationProvider", () => {
  it("defaults to tree navigation on wider windows", () => {
    expect(renderMode()).toBe("tree");
  });

  it("defaults to stack navigation on very small windows", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query === "(max-width: 767px)",
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      onchange: null,
      dispatchEvent: vi.fn(),
    }));

    expect(renderMode()).toBe("stack");
  });

  it("carries panel navigation through the registered navigation boundary", () => {
    const handler = vi.fn();
    render(
      <NavigationProvider>
        <NavigationProbe handler={handler} />
      </NavigationProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Navigate" }));

    expect(handler).toHaveBeenCalledWith("panel-child");
  });

  it("keeps navigation actions stable while layout visibility changes", () => {
    const actionsRendered = vi.fn();
    function Toggle() {
      const { setAddressBarVisible } = useNavigationActions();
      return (
        <button onClick={() => setAddressBarVisible(true)}>Edit address</button>
      );
    }
    render(
      <NavigationProvider>
        <ActionsRenderProbe rendered={actionsRendered} />
        <Toggle />
      </NavigationProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit address" }));
    expect(actionsRendered).toHaveBeenCalledTimes(1);
  });
});
