import React from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button } from "./ui/primitives";
import { radius, spacing, type } from "@workspace/client-kit-native/ui";
import { clientApi } from "@workspace/client-kit-native/host";
import type { StackNavigationProp } from "@workspace/mobile-navigation";
import { useAtomValue, useSetAtom } from "jotai";
import type { RootStackParamList } from "../navigation/RootNavigator";
import type { ShellClient } from "../services/shellClient";
import {
  serverUrlAtom,
  isAuthenticatedAtom,
  authLoadingAtom,
  authErrorAtom,
} from "../state/authAtoms";
import {
  connectionStatusAtom,
  workspaceReadinessAtom,
} from "../state/connectionAtoms";
import { shellClientAtom } from "../state/shellClientAtom";
import {
  createMobileWorkspaceDirectory,
  type MobileWorkspaceDirectory,
} from "../services/workspaceDirectory";
import { workspaceDirectoryAtom } from "../state/workspaceDirectoryAtom";
import { themeColorsAtom } from "../state/themeAtoms";
import { VibestudioLogo } from "./VibestudioLogo";

function smokePhase(phase: string, details?: Record<string, unknown>): void {
  const suffix = details ? ` ${JSON.stringify(details)}` : "";
  console.log(`[VibestudioMobileSmoke] phase=${phase}${suffix}`);
}

type ConnectScreenNavigationProp = StackNavigationProp<
  RootStackParamList,
  "Connect"
>;

interface ConnectScreenProps {
  navigation: ConnectScreenNavigationProp;
}

/**
 * Opens this client's account through the host and enters the shell. The host
 * owns pairing and the device credential: this client never runs unpaired, so
 * there is nothing to enter or replace here, only a connection to retry.
 */
export function ConnectScreen({ navigation }: ConnectScreenProps) {
  const [retryNonce, setRetryNonce] = React.useState(0);
  const colors = useAtomValue(themeColorsAtom);

  const setServerUrlAtom = useSetAtom(serverUrlAtom);
  const setAuthenticated = useSetAtom(isAuthenticatedAtom);
  const setAuthLoading = useSetAtom(authLoadingAtom);
  const setAuthError = useSetAtom(authErrorAtom);
  const setConnectionStatus = useSetAtom(connectionStatusAtom);
  const setWorkspaceReadiness = useSetAtom(workspaceReadinessAtom);
  const setShellClient = useSetAtom(shellClientAtom);
  const setWorkspaceDirectory = useSetAtom(workspaceDirectoryAtom);
  const authLoading = useAtomValue(authLoadingAtom);
  const authError = useAtomValue(authErrorAtom);
  const [connectionPhase, setConnectionPhase] = React.useState(
    "Connecting to your account…",
  );
  const cancelConnectionRef = React.useRef<(() => void) | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    let pendingDirectory: MobileWorkspaceDirectory | null = null;
    const abort = new AbortController();

    const finishConnectedClient = (client: ShellClient) => {
      smokePhase("workspace-connected");

      setShellClient(client);
      setServerUrlAtom(client.serverUrl);
      setAuthenticated(true);
      setAuthLoading(false);
      setAuthError(null);

      navigation.replace("Main");
    };

    const connect = async () => {
      setAuthLoading(true);
      setAuthError(null);
      setWorkspaceReadiness("connecting");
      setConnectionPhase("Opening your workspaces…");
      try {
        smokePhase("workspace-connect-start");
        cancelConnectionRef.current = () => {
          cancelled = true;
          abort.abort();
          setAuthLoading(false);
          setAuthError("Connection cancelled. Your pairing is unchanged.");
        };
        const directory = await createMobileWorkspaceDirectory(
          clientApi(),
          abort.signal,
        );
        pendingDirectory = directory;
        if (cancelled) {
          await directory.dispose();
          return;
        }
        const selected = directory.activeWorkspaceId
          ? directory.sessions.get(directory.activeWorkspaceId)
          : undefined;
        if (!selected)
          throw new Error("The selected workspace did not finish opening.");
        setWorkspaceDirectory(directory);
        pendingDirectory = null;
        setConnectionStatus(selected.client.transport.status);
        setWorkspaceReadiness("shell-ready");
        finishConnectedClient(selected.client);
        cancelConnectionRef.current = null;
      } catch (error) {
        await pendingDirectory?.dispose();
        pendingDirectory = null;
        if (cancelled) return;
        setAuthLoading(false);
        const message =
          error instanceof Error
            ? error.message
            : "Could not open the selected workspace.";
        smokePhase("workspace-connect-error", {
          message,
          name: error instanceof Error ? error.name : typeof error,
          stack:
            error instanceof Error && error.stack
              ? error.stack.split("\n").slice(0, 5).join(" || ")
              : undefined,
        });
        setAuthError(message);
      }
    };

    void connect();

    return () => {
      cancelled = true;
      if (pendingDirectory) void pendingDirectory.dispose();
      if (cancelConnectionRef.current) abort.abort();
      cancelConnectionRef.current = null;
    };
  }, [
    navigation,
    retryNonce,
    setAuthError,
    setAuthLoading,
    setAuthenticated,
    setConnectionStatus,
    setServerUrlAtom,
    setShellClient,
    setWorkspaceDirectory,
    setWorkspaceReadiness,
  ]);

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        bounces={false}
        showsVerticalScrollIndicator={false}
      >
        <VibestudioLogo size={156} variant="logo" style={styles.brandMark} />
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          Your workspaces, together
        </Text>

        {authLoading ? (
          <View style={styles.loadingBlock}>
            <ActivityIndicator color={colors.accent} size="large" />
            <Text style={[styles.message, { color: colors.textSecondary }]}>
              {connectionPhase}
            </Text>
            <Button
              label="Cancel"
              variant="outline"
              onPress={() => cancelConnectionRef.current?.()}
              style={styles.fullButton}
            />
          </View>
        ) : null}

        {authError ? (
          <View style={styles.errorBlock}>
            <View
              style={[
                styles.errorCallout,
                {
                  backgroundColor: colors.dangerSoft,
                  borderColor: colors.danger,
                },
              ]}
            >
              <Text
                style={[type.bodyStrong, { color: colors.danger }]}
                accessibilityRole="alert"
              >
                {authError}
              </Text>
              <Text
                style={[
                  type.caption,
                  styles.calloutHint,
                  { color: colors.textSecondary },
                ]}
              >
                Retry keeps this device's pairing.
              </Text>
            </View>
            <Button
              label="Retry"
              variant="filled"
              onPress={() => setRetryNonce((value) => value + 1)}
              style={styles.fullButton}
            />
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    alignItems: "center",
    flexGrow: 1,
    justifyContent: "center",
    padding: spacing.xl,
  },
  brandMark: {
    marginBottom: spacing.lg,
  },
  subtitle: {
    ...type.body,
    fontSize: 16,
    marginBottom: spacing.xxl,
    textAlign: "center",
  },
  loadingBlock: {
    alignItems: "center",
    gap: spacing.md,
    width: "100%",
  },
  errorBlock: {
    alignItems: "center",
    gap: spacing.md,
    width: "100%",
  },
  message: {
    ...type.caption,
    textAlign: "center",
  },
  errorCallout: {
    width: "100%",
    borderRadius: radius.md,
    borderWidth: 1,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  calloutHint: {
    marginTop: spacing.xs,
  },
  fullButton: {
    width: "100%",
  },
});
