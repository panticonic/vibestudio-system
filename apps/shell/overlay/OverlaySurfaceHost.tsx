/**
 * Root of the content-overlay document (mounted by index.tsx when the URL hash
 * is `#overlaySurface=<key>`). It listens for render messages from main, applies
 * the chrome's theme, renders the registered surface, and reports its content
 * size back for auto-fit. The document background is transparent so the live
 * panel shows through everywhere except the surface itself.
 */
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Theme } from "@radix-ui/themes";
import { getContentOverlayBridge } from "./overlayBridge";
import { getOverlaySurface } from "./registry";
import type { OverlayRenderMessage } from "./types";
import { OverlayWindowContext } from "./OverlayWindowControls";

/** Transparent margin around the surface so its elevation shadow isn't clipped
 *  by the native view's rectangular bounds. */
const SURFACE_MARGIN = 16;
/** Compact approval-card view width, mirrored from ShellContentOverlayView. */
const SURFACE_MIN_WIDTH = 472;

/** Elements that should consume a pointer-down themselves rather than start a
 *  drag. A surface marks its grab region with `[data-overlay-drag-handle]`. */
const NON_DRAGGABLE =
  'button, a, input, textarea, select, summary, [role="button"], [contenteditable="true"], [data-no-drag]';

export function OverlaySurfaceHost() {
  const [message, setMessage] = useState<OverlayRenderMessage | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const resizingRef = useRef(false);
  const bridge = getContentOverlayBridge();

  useEffect(() => {
    if (!bridge) return;
    return bridge.onRender(setMessage);
  }, [bridge]);

  // Report the rendered size (incl. margin) whenever the content changes so main
  // can size the native view to fit. Layout effect + ResizeObserver keeps it
  // tight to actual paint.
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el || !bridge || message?.layout) return;
    const report = () => {
      const rect = el.getBoundingClientRect();
      bridge.reportSize({
        width: Math.ceil(
          Math.min(
            Math.max(rect.width, el.scrollWidth),
            message?.maxWidth ?? rect.width,
          ),
        ),
        height: Math.ceil(rect.height),
      });
    };
    report();
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(report);
    observer?.observe(el);
    return () => observer?.disconnect();
  }, [bridge, message]);

  if (!message) return null;
  const Surface = getOverlaySurface(message.surface);
  if (!Surface) return null;

  // Drag the overlay by a surface-designated handle. We forward screen
  // coordinates (stable as the native view moves under the cursor); main owns
  // the final position. Interactive
  // elements inside the handle keep their own pointer behavior.
  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!bridge || event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest("[data-overlay-resize]")) {
      event.preventDefault();
      resizingRef.current = true;
      event.currentTarget.setPointerCapture(event.pointerId);
      bridge.reportGeometry("resize-start", event.screenX, event.screenY);
      return;
    }
    if (!target.closest("[data-overlay-drag-handle]")) return;
    if (target.closest(NON_DRAGGABLE)) return;
    draggingRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    document.documentElement.dataset["overlayDragging"] = "true";
    bridge.reportDrag("start", event.screenX, event.screenY);
  };
  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (resizingRef.current && bridge) {
      bridge.reportGeometry("resize-move", event.screenX, event.screenY);
      return;
    }
    if (!draggingRef.current || !bridge) return;
    bridge.reportDrag("move", event.screenX, event.screenY);
  };
  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (resizingRef.current && bridge) {
      resizingRef.current = false;
      bridge.reportGeometry("resize-end", event.screenX, event.screenY);
      if (event.currentTarget.hasPointerCapture(event.pointerId))
        event.currentTarget.releasePointerCapture(event.pointerId);
      return;
    }
    if (!draggingRef.current || !bridge) return;
    draggingRef.current = false;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // The pointer may already be released.
    }
    delete document.documentElement.dataset["overlayDragging"];
    bridge.reportDrag("end", event.screenX, event.screenY);
  };

  const theme = message.theme;
  const layout = message.layout;
  const contentWidth = layout
    ? Math.max(0, layout.width - SURFACE_MARGIN * 2)
    : message.maxWidth;
  const contentHeight = layout
    ? Math.max(0, layout.height - SURFACE_MARGIN * 2)
    : message.maxHeight;
  const boxStyle = {
    position: "relative",
    padding: SURFACE_MARGIN,
    width: layout ? layout.width : "max-content",
    height: layout?.height,
    minWidth: layout ? 0 : Math.min(SURFACE_MIN_WIDTH, message.maxWidth),
    maxWidth: layout?.width ?? message.maxWidth,
    maxHeight: layout?.height ?? message.maxHeight + SURFACE_MARGIN * 2,
    boxSizing: "border-box",
    display: "flex",
    background: "transparent",
    "--overlay-min-width": `${Math.min(SURFACE_MIN_WIDTH, message.maxWidth)}px`,
    "--overlay-max-width": `${contentWidth}px`,
    "--overlay-max-height": `${contentHeight}px`,
    ...(layout
      ? {
          "--overlay-width": `${contentWidth}px`,
          "--overlay-height": `${contentHeight}px`,
        }
      : {}),
  } as CSSProperties;
  return (
    <Theme
      appearance={theme.appearance}
      hasBackground={false}
      {...(theme.accentColor ? { accentColor: theme.accentColor } : {})}
      {...(theme.grayColor ? { grayColor: theme.grayColor } : {})}
      {...(theme.panelBackground
        ? { panelBackground: theme.panelBackground }
        : {})}
      {...(theme.radius ? { radius: theme.radius } : {})}
      {...(theme.scaling ? { scaling: theme.scaling } : {})}
      style={{ background: "transparent", minHeight: 0 }}
    >
      <div
        ref={boxRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={endDrag}
        onDoubleClick={(event) => {
          const target = event.target as HTMLElement;
          if (
            message.surface === "quickfire" &&
            target.closest("[data-overlay-drag-handle]") &&
            !target.closest(NON_DRAGGABLE)
          )
            bridge?.reportGeometry("toggle-expand");
        }}
        style={boxStyle}
      >
        <OverlayWindowContext.Provider
          value={{
            expanded: layout?.expanded ?? false,
            toggle: () => bridge?.reportGeometry("toggle-expand"),
          }}
        >
          <Surface
            props={message.props}
            emitIntent={(payload) => bridge?.emitIntent(payload)}
          />
        </OverlayWindowContext.Provider>
        {message.surface === "quickfire" && !layout?.expanded ? (
          <div
            data-overlay-resize=""
            className="overlay-resize-grip"
            title="Drag to resize"
          />
        ) : null}
      </div>
    </Theme>
  );
}
