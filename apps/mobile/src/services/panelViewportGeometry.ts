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
  cornerRadiusTopLeftHint: number;
  cornerRadiusTopRightHint: number;
  cornerRadiusBottomLeftHint: number;
  cornerRadiusBottomRightHint: number;
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
  const radius = Math.round(
    Math.min(56, Math.max(24, Math.min(window.width, window.height) * 0.12)),
  );
  const left = Math.abs(panel.x - window.x) < 0.5;
  const right = Math.abs(panel.x + panel.width - window.x - window.width) < 0.5;
  const top = Math.abs(panel.y - window.y) < 0.5;
  const bottom =
    Math.abs(panel.y + panel.height - window.y - window.height) < 0.5;
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
    cornerRadiusHint: radius,
    cornerRadiusTopLeftHint: top && left ? radius : 0,
    cornerRadiusTopRightHint: top && right ? radius : 0,
    cornerRadiusBottomLeftHint: bottom && left ? radius : 0,
    cornerRadiusBottomRightHint: bottom && right ? radius : 0,
  };
}

/** Publish geometry only. Panels opt into it; the host never pads their DOM. */
export function panelViewportGeometryScript(
  geometry: PanelViewportGeometry,
): string {
  const properties = Object.entries(geometry).map(([edge, value]) => [
    edge.startsWith("cornerRadius")
      ? `--vibestudio-viewport-${edge.replace(/[A-Z]/g, (letter) => "-" + letter.toLowerCase())}`
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
