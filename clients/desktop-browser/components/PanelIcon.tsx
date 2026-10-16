import { lazy, Suspense, type ComponentProps } from "react";
import { GlobeIcon } from "@radix-ui/react-icons";
import { UnitIcon } from "@workspace/client-kit-web";
import type { PanelNavigationState } from "@vibestudio/shared/types";

const BrowserFavicon = lazy(async () => {
  const module = await import("./BrowserFavicon");
  return { default: module.BrowserFavicon };
});

/**
 * A panel's icon: the browser page's favicon when it has one, otherwise the
 * unit's own icon (the kit's `UnitIcon`).
 */
export function PanelIcon({
  favicon,
  ...icon
}: ComponentProps<typeof UnitIcon> & {
  favicon?: PanelNavigationState["favicon"];
}) {
  if (favicon) {
    const size = icon.size ?? 16;
    return (
      <Suspense fallback={<GlobeIcon width={size} height={size} />}>
        <span style={{ display: "inline-flex", filter: "saturate(0.7)" }}>
          <BrowserFavicon handle={favicon} size={size} />
        </span>
      </Suspense>
    );
  }
  return <UnitIcon {...icon} />;
}
