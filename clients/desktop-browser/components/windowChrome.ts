export const isMac = /Mac|iPhone|iPad|iPod/i.test(
  (
    globalThis.navigator as
      | { userAgentData?: { platform?: string } }
      | undefined
  )?.userAgentData?.platform ??
    globalThis.navigator?.platform ??
    globalThis.navigator?.userAgent ??
    "",
);
export const MACOS_TITLEBAR_CONTROL_RESERVE_PX = 68;
export const WINDOW_CONTROL_RESERVE_PX = 138;

// The collapsed navigation must still contain the native traffic lights.
export const WORKSPACE_CONTROL_RAIL_WIDTH_PX = isMac
  ? MACOS_TITLEBAR_CONTROL_RESERVE_PX
  : 44;
