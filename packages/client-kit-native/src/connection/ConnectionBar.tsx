/**
 * ConnectionBar -- a thin status bar for the workspace server connection.
 *
 * What it says comes from `@workspace/connection-core` (the tracker's view and
 * its status line); this only draws it:
 * - Connected: green, auto-hides after 3 seconds
 * - Connecting / Reconnecting: yellow, stays visible
 * - No network: red (device has no link and the pipe is not up)
 * - Disconnected: red (server unreachable)
 */
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { Alert, Animated, Pressable, StyleSheet, Text, View } from "react-native";
import {
  connectionStatusLine,
  type ConnectionTone,
  type ConnectionView,
} from "@workspace/connection-core";
import type { SnapshotStore } from "@workspace/snapshot-store";
import { useKitColors } from "../ui/theme";
import { spacing, type } from "../ui/tokens";

/** How far the workspace behind a live connection has come. */
export type ConnectionReadiness = "connecting" | "shell-ready" | "reconciled" | "failed";

export interface ConnectionBarProps {
  /** The connection as `createConnectionTracker` keeps it. */
  tracker: SnapshotStore<ConnectionView>;
  /** Workspace startup continues after the connection is live; omitted means nothing to wait for. */
  readiness?: ConnectionReadiness;
  /** Retry the connection now. */
  onReconnect: () => void;
  /** Retry a workspace setup that failed behind a live connection. */
  onRetrySetup?: () => void;
  /**
   * Invoked when the user chooses "Re-pair" from the problem actions. Screens
   * that can return to the native pairing bootstrap pass this; when omitted,
   * only an immediate reconnect is offered.
   */
  onRepair?: () => void;
}

/** Natural height of the bar: paddingVertical(4)*2 + dot(6) + fontSize(~12) ≈ 24 */
const BAR_HEIGHT = 24;

export function ConnectionBar({
  tracker,
  readiness = "reconciled",
  onReconnect,
  onRetrySetup,
  onRepair,
}: ConnectionBarProps) {
  const view = useSyncExternalStore(tracker.subscribe, tracker.getSnapshot);
  const colors = useKitColors();
  const opacity = useRef(new Animated.Value(1)).current;
  const animatedHeight = useRef(new Animated.Value(BAR_HEIGHT)).current;
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const online = view.phase === "online";
  const offline = view.offline === true;

  useEffect(() => {
    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }

    // Always show on a state change.
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: false }),
      Animated.timing(animatedHeight, {
        toValue: BAR_HEIGHT,
        duration: 200,
        useNativeDriver: false,
      }),
    ]).start();

    // Auto-hide when connected (after 3 seconds). A live pipe is reachable by
    // definition, so this is not gated on the device's reachability signal.
    if (online) {
      hideTimer.current = setTimeout(() => {
        Animated.parallel([
          Animated.timing(opacity, { toValue: 0, duration: 500, useNativeDriver: false }),
          Animated.timing(animatedHeight, {
            toValue: 0,
            duration: 500,
            useNativeDriver: false,
          }),
        ]).start();
      }, 3000);
    }

    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [online, offline, readiness, opacity, animatedHeight]);

  // The bar is actionable whenever the connection is in a problem state so the
  // user is never stuck without a way to retry or re-pair. A live pipe is never
  // a problem, even when the device reports no internet (LAN-only server).
  const isProblem = !online || readiness === "failed";

  const handlePress = useCallback(() => {
    const buttons: Parameters<typeof Alert.alert>[2] =
      readiness === "failed"
        ? [{ text: "Retry setup", onPress: () => onRetrySetup?.() }]
        : [{ text: "Reconnect", onPress: onReconnect }];
    if (onRepair) buttons.push({ text: "Re-pair device", onPress: onRepair });
    buttons.push({ text: "Cancel", style: "cancel" });
    Alert.alert(
      readiness === "failed"
        ? "Workspace setup failed"
        : offline
          ? "No network"
          : "Connection lost",
      readiness === "failed"
        ? "The server connection is live, but workspace reconciliation did not finish."
        : offline
          ? "Your device appears to be offline. Reconnect once your network is back."
          : "Vibestudio isn't connected to your server.",
      buttons,
      { cancelable: true },
    );
  }, [offline, onReconnect, onRepair, onRetrySetup, readiness]);

  const line = connectionStatusLine(view);
  const tone: ConnectionTone = online
    ? readiness === "failed"
      ? "problem"
      : readiness !== "reconciled"
        ? "pending"
        : line.tone
    : line.tone;
  const palette =
    tone === "ok"
      ? { background: colors.successSoft, foreground: colors.success }
      : tone === "pending"
        ? { background: colors.warningSoft, foreground: colors.warning }
        : { background: colors.dangerSoft, foreground: colors.danger };
  const reconnectLabel =
    view.everOnline && (view.attempt ?? 0) > 0 && !online
      ? `Reconnecting (attempt ${view.attempt})…`
      : line.label;
  const label =
    readiness === "failed"
      ? "Workspace setup needs attention — tap to retry"
      : isProblem
        ? `${reconnectLabel} — tap for options`
        : readiness !== "reconciled"
          ? "Preparing workspace…"
          : line.label;
  const accessibilityHint = onRepair
    ? "Opens actions to reconnect or re-pair the device."
    : "Opens actions to reconnect.";

  const content = (
    <Animated.View
      style={[
        styles.container,
        {
          backgroundColor: palette.background,
          opacity,
          height: animatedHeight,
          overflow: "hidden",
        },
      ]}
    >
      <View style={[styles.dot, { backgroundColor: palette.foreground }]} />
      <Text style={[styles.text, { color: palette.foreground }]}>{label}</Text>
    </Animated.View>
  );

  if (!isProblem) return content;

  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={line.label}
      accessibilityHint={accessibilityHint}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.md,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: spacing.xs + 2,
  },
  text: {
    ...type.micro,
  },
});
