// @vitest-environment jsdom

import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { Theme } from "@radix-ui/themes";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NavigationProvider } from "./NavigationContext";
import type { LazyTitleNavigationData } from "./navigationTypes";
import { TitleBar } from "./TitleBar";

vi.mock("@workspace/react/responsive", () => ({
  useIsMobile: () => false,
  useTouchDevice: () => false,
}));
vi.mock("../shell/workspaceContext", () => ({
  useShellWorkspaceClient: () => ({ menu: {}, notification: {}, panel: {} }),
  useWorkspaceNavigationHost: () => ({
    workspaceLabel: "Personal",
    sidebarVisible: true,
  }),
  useWorkspaceVisible: () => true,
}));
vi.mock("../shell/client", () => ({}));
vi.mock("./usePanelTrust", () => ({
  usePanelTrust: () => ({ description: "Panel installed in this workspace." }),
}));
vi.mock("./PanelIcon", () => ({ PanelIcon: () => null }));
vi.mock("./BrowserFavicon", () => ({ BrowserFavicon: () => null }));

function Chrome({
  navigation,
}: {
  navigation: LazyTitleNavigationData | null;
}) {
  return <TitleBar navigationData={navigation} />;
}

const panel: LazyTitleNavigationData = {
  ancestors: [],
  current: {
    id: "last-panel",
    title: "I just opened this workspace",
    childCount: 0,
    position: 0,
  },
};

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("TitleBar", () => {
  it("clears the last closed panel", () => {
    const chrome = (navigation: LazyTitleNavigationData | null) => (
      <Theme>
        <NavigationProvider>
          <Chrome navigation={navigation} />
        </NavigationProvider>
      </Theme>
    );
    const { container, getByText, queryByText, rerender } = render(
      chrome(panel),
    );
    expect(getByText(panel.current.title)).toBeTruthy();

    rerender(chrome(null));
    expect(queryByText(panel.current.title)).toBeNull();
    expect(container.querySelector("[data-breadcrumb-id]")).toBeNull();
    expect(queryByText("Personal")).toBeNull();

    rerender(
      chrome({
        ...panel,
        current: { ...panel.current, id: "new-panel", title: "New panel" },
      }),
    );
    expect(getByText("New panel")).toBeTruthy();
    expect(queryByText(panel.current.title)).toBeNull();
  });
  it("keeps each pane's path and child navigation inside its own titlebar", () => {
    const navigateMail = vi.fn();
    const navigateNotes = vi.fn();
    const { getByTestId } = render(
      <Theme>
        <NavigationProvider>
          <div data-testid="mail-pane">
            <TitleBar
              reserveWindowControls={false}
              focused={false}
              navigationData={{
                ...panel,
                current: { ...panel.current, id: "mail", title: "Mail" },
                ancestors: [
                  { id: "inbox", title: "Inbox", childCount: 2, depth: 0 },
                ],
              }}
              statusNavigation={{
                visiblePanelId: "mail",
                descendantGroups: [
                  {
                    depth: 1,
                    parentId: "mail",
                    selectedId: "draft",
                    siblings: [
                      {
                        id: "draft",
                        title: "Draft",
                        childCount: 0,
                        position: 0,
                      },
                    ],
                  },
                ],
              }}
              onNavigateToId={navigateMail}
            />
          </div>
          <div data-testid="notes-pane">
            <TitleBar
              reserveWindowControls={false}
              navigationData={{
                ...panel,
                current: { ...panel.current, id: "notes", title: "Notes" },
              }}
              onNavigateToId={navigateNotes}
            />
          </div>
        </NavigationProvider>
      </Theme>,
    );
    const mail = within(getByTestId("mail-pane"));
    const notes = within(getByTestId("notes-pane"));
    expect(mail.queryByText("Notes")).toBeNull();
    expect(
      mail
        .getByRole("button", { name: "Mail" })
        .hasAttribute("data-breadcrumb-current"),
    ).toBe(false);
    expect(
      notes
        .getByRole("button", { name: "Notes" })
        .getAttribute("data-breadcrumb-current"),
    ).toBe("true");
    expect(notes.queryByText("Mail")).toBeNull();
    expect(notes.queryByText("Draft")).toBeNull();
    fireEvent.click(mail.getByRole("button", { name: "Inbox" }));
    fireEvent.click(mail.getByRole("button", { name: "Draft" }));
    fireEvent.click(mail.getByRole("button", { name: "Mail" }));
    expect(navigateMail.mock.calls).toEqual([["inbox"], ["draft"], ["mail"]]);
    expect(navigateNotes).not.toHaveBeenCalled();
  });
});
