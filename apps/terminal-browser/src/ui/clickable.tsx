import React from "react";
import { Box, Text, type DOMElement } from "ink";

/**
 * What a click on a region does: optionally move a selection first, then
 * press the key that acts on it, through the same input path as typing.
 * `confirm` regions (decisions, destructive or opening actions) act only
 * when the button is released over the region it was pressed on, so a
 * click that starts or ends anywhere else does nothing.
 */
export interface ClickAction {
  key?: string;
  confirm?: boolean;
  /** Approvals: the protected-form stop to focus (a field, or the Submit stop). */
  field?: number;
  /** Approvals: the install-review part to focus. */
  part?: number;
  /** Approvals: the task-rules row to focus. */
  rule?: number;
}

interface Region {
  node: DOMElement;
  action: ClickAction;
}

/**
 * The clickable regions of one Ink tree, located with the layout Ink itself
 * computed for drawing it, so what a click hits is exactly what was drawn
 * there, however the text wrapped or the content scrolled.
 */
export class ClickRegions {
  private readonly regions = new Map<string, Region>();

  set(id: string, region: Region): void {
    this.regions.set(id, region);
  }

  delete(id: string, node: DOMElement): void {
    if (this.regions.get(id)?.node === node) this.regions.delete(id);
  }

  /** The region under tree-relative cell (x, y), with its id. */
  at(x: number, y: number): { id: string; action: ClickAction } | null {
    for (const [id, region] of this.regions) {
      const rect = visibleRect(region.node);
      if (rect && x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height)
        return { id, action: region.action };
    }
    return null;
  }
}

const RegionsContext = React.createContext<ClickRegions | null>(null);

export function ClickRegionsProvider({
  regions,
  children,
}: {
  regions: ClickRegions;
  children: React.ReactNode;
}): React.ReactElement {
  return <RegionsContext.Provider value={regions}>{children}</RegionsContext.Provider>;
}

/** A box that is also a button: `id` must be unique within its tree. */
export function Clickable({
  id,
  action,
  children,
  flexDirection = "row",
}: {
  id: string;
  action: ClickAction;
  children: React.ReactNode;
  flexDirection?: "row" | "column";
}): React.ReactElement {
  const regions = React.useContext(RegionsContext);
  const ref = React.useRef<DOMElement>(null);
  React.useLayoutEffect(() => {
    const node = ref.current;
    if (!regions || !node) return;
    regions.set(id, { node, action });
    return () => regions.delete(id, node);
  });
  return (
    <Box ref={ref} flexDirection={flexDirection} flexShrink={0}>
      {children}
    </Box>
  );
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A node's laid-out rectangle in its tree, clipped by every hidden-overflow ancestor. */
function visibleRect(node: DOMElement): Rect | null {
  const own = absoluteRect(node);
  if (!own) return null;
  let rect: Rect = own;
  for (let parent = node.parentNode; parent; parent = parent.parentNode) {
    const style = parent.style ?? {};
    if (style.overflow !== "hidden" && style.overflowY !== "hidden") continue;
    const clip = absoluteRect(parent);
    if (!clip) return null;
    const y0 = Math.max(rect.y, clip.y);
    const y1 = Math.min(rect.y + rect.height, clip.y + clip.height);
    if (y1 <= y0) return null;
    rect = { ...rect, y: y0, height: y1 - y0 };
  }
  return rect;
}

function absoluteRect(node: DOMElement): Rect | null {
  const yoga = node.yogaNode;
  if (!yoga) return null;
  let x = 0;
  let y = 0;
  for (let at: DOMElement | undefined = node; at; at = at.parentNode) {
    if (!at.yogaNode) continue;
    x += at.yogaNode.getComputedLeft();
    y += at.yogaNode.getComputedTop();
  }
  return {
    x,
    y,
    width: yoga.getComputedWidth(),
    height: yoga.getComputedHeight(),
  };
}

export interface Button {
  id: string;
  label: string;
  action: ClickAction;
  color?: "green" | "red" | "yellow" | "cyan";
}

/**
 * A one-line row of buttons, clipped to its width. Each is a filled block, so
 * it reads as something to press: its color fills it, or it is drawn inverse.
 */
export function ButtonRow({ buttons }: { buttons: readonly Button[] }): React.ReactElement {
  return (
    <Box height={1} overflow="hidden" flexShrink={0}>
      {buttons.map((button, index) => (
        <React.Fragment key={button.id}>
          {index > 0 ? <Text>{"  "}</Text> : null}
          <Clickable id={button.id} action={button.action}>
            <Text
              bold
              {...(button.color
                ? { backgroundColor: button.color, color: "black" }
                : { inverse: true })}
              wrap="truncate-end"
            >
              {` ${button.label} `}
            </Text>
          </Clickable>
        </React.Fragment>
      ))}
    </Box>
  );
}
