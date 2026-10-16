import {
  ComponentInstanceIcon,
  CubeIcon,
  DashboardIcon,
  DesktopIcon,
  GearIcon,
  GlobeIcon
} from "@radix-ui/react-icons";
import { useEffect, useState } from "react";
import { isSemanticEmoji, isUnitIconAssetPath } from "@vibestudio/shared/panel/icon";
import { useWorkspaceIcons } from "./workspaceIconsContext";

/**
 * A unit's icon: an emoji it declares, an image it ships (resolved through the
 * surrounding `WorkspaceIconsContext`), or the typed fallback glyph.
 */
export function UnitIcon({
  icon,
  iconVersion,
  iconState,
  source,
  size = 16,
  fallback = false
}: {
  icon?: string;
  /** Names the icon's content so the fetched glyph can be stored forever. */
  iconVersion?: string;
  /** Exact workspace state from which a historical icon can be retrieved. */
  iconState?: string;
  source?: string;
  size?: number;
  fallback?: "panel" | "browser" | "worker" | "client" | "extension" | "system" | false;
}) {
  const unitIcons = useWorkspaceIcons();
  const key = JSON.stringify([source, icon, iconVersion, iconState]);
  const [image, setImage] = useState<{
    owner: typeof unitIcons;
    key: string;
    url: string;
  } | null>(null);
  const imageSource = icon?.startsWith("data:image/")
    ? icon
    : image?.owner === unitIcons && image.key === key
      ? image.url
      : null;
  const [failedSource, setFailedSource] = useState<string | null>(null);
  useEffect(() => {
    if (!unitIcons || !isUnitIconAssetPath(icon) || !source) return;
    let active = true;
    void unitIcons
      .load(source, icon, iconVersion, iconState)
      .then((url) => {
        if (active) setImage({ owner: unitIcons, key, url });
      })
      .catch(() => {
        /* The declared fallback is the icon's error state. */
      });
    return () => {
      active = false;
    };
  }, [unitIcons, source, icon, iconVersion, iconState, key]);
  if (imageSource && failedSource !== imageSource) {
    return (
      <img
        src={imageSource}
        alt=""
        aria-hidden="true"
        loading="lazy"
        decoding="async"
        width={size}
        height={size}
        style={{
          width: size,
          height: size,
          flexShrink: 0,
          display: "block",
          objectFit: "contain",
          borderRadius: Math.max(2, Math.round(size * 0.2)),
          filter: "saturate(0.7)"
        }}
        onError={() => setFailedSource(imageSource)}
      />
    );
  }
  if (isSemanticEmoji(icon)) {
    return (
      <span
        aria-hidden="true"
        style={{
          width: size,
          height: size,
          flexShrink: 0,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: size,
          lineHeight: 1,
          fontFamily: "Apple Color Emoji, Segoe UI Emoji, Noto Color Emoji, sans-serif",
          filter: "saturate(0.7)"
        }}
      >
        {icon}
      </span>
    );
  }
  if (!fallback) return null;
  const props = { width: size, height: size, style: { flexShrink: 0 } };
  if (fallback === "browser") return <GlobeIcon {...props} />;
  if (fallback === "panel") return <DashboardIcon {...props} />;
  if (fallback === "worker") return <GearIcon {...props} />;
  if (fallback === "client") return <DesktopIcon {...props} />;
  if (fallback === "extension") return <ComponentInstanceIcon {...props} />;
  return <CubeIcon {...props} />;
}
