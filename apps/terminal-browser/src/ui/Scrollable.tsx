import React from "react";
import { Box, measureElement, type DOMElement } from "ink";

export interface ScrollableProps {
  /** Visible rows. */
  height: number;
  /** Rows scrolled past the top; the owner clamps it with the reported content height. */
  scroll: number;
  /** Reports the natural height of the content after each layout. */
  onContentHeight?: (rows: number) => void;
  children: React.ReactNode;
}

/**
 * A fixed-height window onto taller content. Ink has no scroll container, so
 * the content keeps its natural height and is shifted up inside a clipping
 * box; the owner learns the content height to clamp `scroll` and to say how
 * much is left above and below.
 */
export function Scrollable({
  height,
  scroll,
  onContentHeight,
  children,
}: ScrollableProps): React.ReactElement {
  const content = React.useRef<DOMElement>(null);
  React.useEffect(() => {
    if (content.current && onContentHeight) onContentHeight(measureElement(content.current).height);
  });
  return (
    <Box height={height} overflow="hidden" flexDirection="column" flexShrink={0}>
      <Box ref={content} flexDirection="column" flexShrink={0} marginTop={-scroll}>
        {children}
      </Box>
    </Box>
  );
}

/** Clamp a scroll offset to the scrollable range. */
export function clampScroll(scroll: number, contentHeight: number, height: number): number {
  return Math.min(Math.max(0, scroll), Math.max(0, contentHeight - height));
}
