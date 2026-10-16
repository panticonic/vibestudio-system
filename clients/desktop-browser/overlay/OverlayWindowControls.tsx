import { createContext, useContext } from "react";
import { Maximize2, Minimize2 } from "@workspace/ui/icons";

export const OverlayWindowContext = createContext<{
  expanded: boolean;
  toggle: () => void;
} | null>(null);

export function OverlayWindowControls() {
  const window = useContext(OverlayWindowContext);
  if (!window) return null;
  const label = window.expanded ? "Restore overlay size" : "Expand overlay";
  const Icon = window.expanded ? Minimize2 : Maximize2;
  return (
    <button
      className="overlay-expand"
      type="button"
      aria-label={label}
      title={label}
      onClick={window.toggle}
    >
      <Icon size={15} />
    </button>
  );
}
