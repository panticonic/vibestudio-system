export interface ViewportFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface ViewportInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}
export interface PanelViewportGeometry extends ViewportInsets {
  cornerRadiusHint: number;
}

/** Intersect the panel's actual native frame with the window's safe rectangle.
 * A header or keyboard that already excludes an edge must not inset it again. */
export function panelViewportGeometry(
  panel: ViewportFrame,
  window: ViewportFrame,
  insets: ViewportInsets,
): PanelViewportGeometry {
  const clamp = (value: number, size: number) =>
    Math.min(Math.max(value, 0), size);
  return {
    top: clamp(window.y + insets.top - panel.y, panel.height),
    left: clamp(window.x + insets.left - panel.x, panel.width),
    bottom: clamp(
      panel.y + panel.height - (window.y + window.height - insets.bottom),
      panel.height,
    ),
    right: clamp(
      panel.x + panel.width - (window.x + window.width - insets.right),
      panel.width,
    ),
    // Public iOS APIs do not expose display corner radii. This is an optional
    // appearance hint based on the window's short side, never a clipping mask.
    cornerRadiusHint: Math.round(
      Math.min(56, Math.max(24, Math.min(window.width, window.height) * 0.12)),
    ),
  };
}

/** Publish geometry only. Panels opt into it; the host never pads their DOM. */
export function panelViewportGeometryScript(
  geometry: PanelViewportGeometry,
): string {
  const properties = Object.entries(geometry).map(([edge, value]) => [
    edge === "cornerRadiusHint"
      ? "--vibestudio-viewport-corner-radius-hint"
      : `--vibestudio-safe-area-inset-${edge}`,
    `${value}px`,
  ]);
  return `(function () {
    const properties = ${JSON.stringify(properties)};
    function apply() {
      const root = document.documentElement;
      if (!root) return;
      for (const [name, value] of properties) {
        if (root.style.getPropertyValue(name) !== value) root.style.setProperty(name, value);
      }
    }
    if (document.documentElement) apply();
    else document.addEventListener("DOMContentLoaded", apply, { once: true });
  })(); true;`;
}
