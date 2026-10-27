import { WINDOW_CONTROL_RESERVE_PX } from "./windowChrome";
import type { ReactNode, CSSProperties } from "react";
import { Cross2Icon, DragHandleDots2Icon } from "@radix-ui/react-icons";
import { Box, Flex, IconButton, Tooltip } from "@radix-ui/themes";

import { useLayoutDrag } from "../shell/hooks/LayoutDragContext";
import { PaneContent } from "./PaneContent";
import { PANE_TITLEBAR_HEIGHT, type LayoutPane } from "../layout/types";

/** The grip is a move handle once focused, so plain arrows place the pane. */
const ARROW_DIRECTIONS: Record<
  string,
  "left" | "right" | "up" | "down" | undefined
> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
};

interface PaneViewProps {
  titleBar: ReactNode;
  reserveWindowControls?: boolean;
  pane: LayoutPane;
  focused: boolean;
  /** The panel's title, shown on the chip while this pane is being dragged. */
  title: string;
  resident: boolean;
  layoutEpoch: number;
  unresponsive: boolean;
  onDismissUnresponsive: (panelId: string) => void;
  onFocusPane: (paneId: string) => void;
  onClosePane?: (paneId: string) => void;
  /** Arrow-key placement while the grip has keyboard focus. */
  onMovePane: (
    paneId: string,
    direction: "left" | "right" | "up" | "down",
  ) => void;
}

/** One pane owns its permanent titlebar and native content surface. */
export function PaneView({
  titleBar,
  reserveWindowControls,
  pane,
  focused,
  title,
  resident,
  layoutEpoch,
  unresponsive,
  onDismissUnresponsive,
  onFocusPane,
  onClosePane,
  onMovePane,
}: PaneViewProps) {
  const { beginPaneDrag } = useLayoutDrag();
  const movable = Boolean(onClosePane);

  return (
    <Flex
      direction="column"
      data-pane-id={pane.id}
      data-pane-panel-id={pane.panelId}
      data-pane-focused={focused ? "true" : "false"}
      style={{
        flex: `${pane.heightFr} 1 0`,
        minHeight: 0,
        minWidth: 0,
        // Square, deliberately. A radius here only ever reached the top two
        // corners: the top strip is shell DOM and gets clipped, while the rest
        // of the pane is a natively composited view that `overflow: hidden`
        // cannot touch — so the frame read rounded above and square below.
        // Rounding both would mean rounding the native view host-side; flush is
        // the house style for structural panes anyway (see overrides.css, where
        // the sidebar card sets border-radius: 0 for the same reason).
        borderRadius: 0,
        overflow: "hidden",
      }}
    >
      <Box
        data-pane-titlebar={pane.id}
        style={{ height: PANE_TITLEBAR_HEIGHT, flexShrink: 0 }}
      >
        <Flex
          align="center"
          style={{
            height: "100%",
            background: "var(--app-chrome-bg)",
            borderBottom: "1px solid var(--gray-a5)",
          }}
        >
          <button
            type="button"
            aria-label={`Move ${title}`}
            title="Drag to move this pane, or use the arrow keys"
            aria-keyshortcuts={
              movable ? "ArrowLeft ArrowRight ArrowUp ArrowDown" : undefined
            }
            tabIndex={movable ? 0 : -1}
            data-pane-drag-handle={pane.id}
            onPointerDown={(event) => {
              if (!movable) return;
              beginPaneDrag(event, {
                panelId: pane.panelId,
                title,
                fromPaneId: pane.id,
              });
            }}
            onKeyDown={(event) => {
              if (!movable) return;
              const direction = ARROW_DIRECTIONS[event.key];
              if (!direction || event.ctrlKey || event.metaKey || event.altKey)
                return;
              event.preventDefault();
              onMovePane(pane.id, direction);
            }}
            style={
              {
                flex: "0 0 24px",
                height: "100%",
                minWidth: 0,
                padding: 0,
                border: 0,
                background: "transparent",
                cursor: movable ? "grab" : "pointer",
                appRegion: "no-drag",
                WebkitAppRegion: "no-drag",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              } as CSSProperties
            }
          >
            <DragHandleDots2Icon width={12} height={12} />
          </button>
          <Box
            style={{ flex: "1 1 0", minWidth: 0 }}
            onPointerDown={() => onFocusPane(pane.id)}
            onFocusCapture={() => onFocusPane(pane.id)}
          >
            {titleBar}
          </Box>
          {onClosePane && (
            <Tooltip content="Close pane — panel stays in the tree">
              <IconButton
                size="1"
                variant="soft"
                color="gray"
                radius="small"
                aria-label="Close pane"
                data-pane-close={pane.id}
                tabIndex={0}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  onClosePane(pane.id);
                }}
                style={
                  {
                    appRegion: "no-drag",
                    WebkitAppRegion: "no-drag",
                    width: PANE_TITLEBAR_HEIGHT - 5,
                    height: PANE_TITLEBAR_HEIGHT - 5,
                    flexShrink: 0,
                    margin: "0 2px",
                    padding: 0,
                  } as CSSProperties
                }
              >
                <Cross2Icon width={12} height={12} />
              </IconButton>
            </Tooltip>
          )}
          {reserveWindowControls && (
            <Box style={{ width: WINDOW_CONTROL_RESERVE_PX, flexShrink: 0 }} />
          )}
        </Flex>
      </Box>
      <Flex
        direction="column"
        style={{ flex: "1 1 0", minHeight: 0, minWidth: 0 }}
      >
        <PaneContent
          paneId={pane.id}
          panelId={pane.panelId}
          resident={resident}
          focused={focused}
          layoutEpoch={layoutEpoch}
          unresponsive={unresponsive}
          onDismissUnresponsive={onDismissUnresponsive}
          onFocusPane={onFocusPane}
        />
      </Flex>
    </Flex>
  );
}
