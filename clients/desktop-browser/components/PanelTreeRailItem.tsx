import type { FlattenedPanel } from "../shell/hooks/PanelTreeContext";
import { isPanelClosePointerButton } from "@vibestudio/shared/panelCommands";
import { PanelIcon } from "./PanelIcon";
import { confirmClosePanel } from "./ConfirmDialog";
import type { TreeMoveKey } from "./panelTreeKeyboard";

/** The same tree navigation target, presented as one icon with its full path. */
export function PanelTreeRailItem({
  item,
  title,
  selected,
  visible,
  onSelect,
  onMoveFocus,
  onPanelContextMenu,
  onArchive,
}: {
  item: FlattenedPanel;
  title: string;
  selected: boolean;
  visible: boolean;
  onSelect(id: string, options?: { openBeside?: boolean }): void;
  onMoveFocus(id: string, key: TreeMoveKey): void;
  onPanelContextMenu?(id: string, position: { x: number; y: number }): Promise<void>;
  onArchive?(id: string): void;
}) {
  const { panel } = item;
  return (
    <button
      type="button"
      className="panel-tree-rail-item"
      role="treeitem"
      aria-label={panel.title}
      aria-level={item.depth + 1}
      aria-selected={selected}
      aria-expanded={panel.childCount ? true : undefined}
      title={title}
      data-panel-tree-row="true"
      data-panel-id={panel.id}
      data-active={selected}
      data-visible={visible}
      onClick={(event) => onSelect(panel.id, { openBeside: event.ctrlKey || event.metaKey })}
      onKeyDown={(event) => {
        if (["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          onMoveFocus(panel.id, event.key as TreeMoveKey);
        }
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        void onPanelContextMenu?.(panel.id, {
          x: Math.round(event.clientX),
          y: Math.round(event.clientY),
        });
      }}
      onMouseDown={(event) => {
        if (isPanelClosePointerButton(event.button)) event.preventDefault();
      }}
      onAuxClick={(event) => {
        if (!isPanelClosePointerButton(event.button)) return;
        event.preventDefault();
        void (async () => {
          if (panel.childCount && !(await confirmClosePanel(panel.title, panel.childCount))) return;
          onArchive?.(panel.id);
        })();
      }}
    >
      <PanelIcon
        icon={panel.icon}
        iconVersion={panel.iconVersion}
        iconState={panel.iconState}
        source={panel.source}
        favicon={panel.favicon}
        size={18}
        fallback={panel.source?.startsWith("browser:") ? "browser" : "panel"}
      />
    </button>
  );
}
