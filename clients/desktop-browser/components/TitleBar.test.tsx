// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { useEffect } from "react";
import { Theme } from "@radix-ui/themes";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NavigationProvider, useNavigationActions } from "./NavigationContext";
import type { LazyTitleNavigationData } from "./navigationTypes";
import { TitleBar } from "./TitleBar";

const state = vi.hoisted(() => ({ mobile: false }));
vi.mock("@workspace/react/responsive", () => ({
  useIsMobile: () => state.mobile,
  useTouchDevice: () => false,
}));
vi.mock("../shell/workspaceContext", () => ({
  useShellWorkspaceClient: () => ({ menu: {}, notification: {}, panel: {} }),
  useWorkspaceNavigationHost: () => ({ workspaceLabel: "Personal", sidebarVisible: true }),
  useWorkspaceVisible: () => true,
}));
vi.mock("../shell/client", () => ({}));
vi.mock("./usePanelTrust", () => ({
  usePanelTrust: () => ({ description: "Panel installed in this workspace." }),
}));
vi.mock("./PanelIcon", () => ({ PanelIcon: () => null }));
vi.mock("./BrowserFavicon", () => ({ BrowserFavicon: () => null }));

function Chrome({ navigation }: { navigation: LazyTitleNavigationData | null }) {
  const { setLazyTitleNavigation } = useNavigationActions();
  useEffect(() => setLazyTitleNavigation(navigation), [navigation, setLazyTitleNavigation]);
  return <TitleBar />;
}

const panel: LazyTitleNavigationData = {
  ancestors: [],
  currentSiblings: [],
  currentId: "last-panel",
  currentTitle: "I just opened this workspace",
  currentChildCount: 0,
};

beforeEach(() => {
  state.mobile = false;
  localStorage.clear();
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("TitleBar", () => {
  it.each([false, true])("clears the last closed panel on mobile=%s", (mobile) => {
    state.mobile = mobile;
    const chrome = (navigation: LazyTitleNavigationData | null) => (
      <Theme><NavigationProvider><Chrome navigation={navigation} /></NavigationProvider></Theme>
    );
    const { container, getByText, queryByText, rerender } = render(chrome(panel));
    expect(getByText(panel.currentTitle)).toBeTruthy();

    rerender(chrome(null));
    expect(queryByText(panel.currentTitle)).toBeNull();
    expect(container.querySelector("[data-breadcrumb-id]")).toBeNull();
    if (mobile) expect(getByText("Vibestudio")).toBeTruthy();
    else expect(getByText("Personal")).toBeTruthy();

    rerender(chrome({ ...panel, currentId: "new-panel", currentTitle: "New panel" }));
    expect(getByText("New panel")).toBeTruthy();
    expect(queryByText(panel.currentTitle)).toBeNull();
  });
});
