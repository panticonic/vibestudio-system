// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PanelTreeRailItem } from "./PanelTreeRailItem";
import type { FlattenedPanel } from "../shell/hooks/PanelTreeContext";

vi.mock("./PanelIcon", () => ({
  PanelIcon: ({ source }: { source: string }) => (
    <span data-icon-source={source} />
  ),
}));
vi.mock("./ConfirmDialog", () => ({ confirmClosePanel: async () => true }));
afterEach(cleanup);

it("navigates from a labelled favicon, supports open-beside, keyboard focus and the existing context actions", async () => {
  const onSelect = vi.fn(),
    onMoveFocus = vi.fn(),
    onPanelContextMenu = vi.fn(async () => {}),
    onArchive = vi.fn();
  const item: FlattenedPanel = {
    id: "mail",
    parentId: "window",
    depth: 2,
    index: 0,
    collapsed: false,
    panel: {
      id: "mail",
      title: "Inbox",
      source: "browser:https://mail.example",
      childCount: 0,
      position: 0,
    },
  };
  const result = render(
    <PanelTreeRailItem
      item={item}
      title="Imported browser › Window › Inbox"
      selected
      visible
      onSelect={onSelect}
      onMoveFocus={onMoveFocus}
      onPanelContextMenu={onPanelContextMenu}
      onArchive={onArchive}
    />,
  );
  const row = screen.getByRole("treeitem", { name: "Inbox" });
  expect(row.title).toBe("Imported browser › Window › Inbox");
  expect(row.getAttribute("aria-selected")).toBe("true");
  expect(
    result.container
      .querySelector("[data-icon-source]")
      ?.getAttribute("data-icon-source"),
  ).toBe(item.panel.source);
  fireEvent.click(row, { ctrlKey: true });
  expect(onSelect).toHaveBeenCalledWith("mail", { openBeside: true });
  fireEvent.keyDown(row, { key: "ArrowDown" });
  expect(onMoveFocus).toHaveBeenCalledWith("mail", "ArrowDown");
  fireEvent.contextMenu(row, { clientX: 12, clientY: 44 });
  expect(onPanelContextMenu).toHaveBeenCalledWith("mail", { x: 12, y: 44 });
  fireEvent(row, new MouseEvent("auxclick", { button: 1, bubbles: true }));
  await waitFor(() => expect(onArchive).toHaveBeenCalledWith("mail"));
});
