// Must be the first import: react-native-gesture-handler requires its native
// side to be initialized before anything renders. The drawer navigator and the
// panel-tree swipe gestures depend on it.
import "react-native-gesture-handler";
import "./src/setupGlobals";
import { workspaceDirectoryAtom } from "./src/state/workspaceDirectoryAtom";
import { useEffect, useRef, useState } from "react";
import { AppRegistry, Appearance, StatusBar, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { BrowserKitProvider } from "./src/state/BrowserKitProvider";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { NavigationContainer } from "@workspace/mobile-navigation";
import { Provider as JotaiProvider, useAtomValue, useSetAtom } from "jotai";
import {
  CLIENT_ROOT_COMPONENT,
  type RnClientApi,
} from "@vibestudio/rn-client-api";
import { connectNativeClientApi } from "@vibestudio/rn-client-api/native";
import { clientApi, installClientApi } from "@workspace/client-kit-native/host";
import { BrowserPrivacyManager } from "./src/components/BrowserPrivacyManager";
import type { MobileBrowserPrivacySection } from "./src/services/shellClient";
import { RootNavigator } from "./src/navigation/RootNavigator";
import { ErrorBoundary } from "./src/components/ErrorBoundary";
import { Toast } from "./src/components/Toast";
import { useHostUpdates } from "./src/hooks/useHostUpdates";
import { observePanelLinks } from "./src/services/panelIntents";
import { registerForPushNotifications } from "./src/services/pushRegistration";
import {
  hydrateThemePreferenceAtom,
  isDarkModeAtom,
  systemColorSchemeAtom,
  themeColorsAtom,
} from "./src/state/themeAtoms";
import { ActionSheetHost } from "./src/components/ui/ActionSheetHost";
import { shellClientAtom } from "./src/state/shellClientAtom";
import { inboxDeepLinkAtom } from "./src/state/inboxDeepLinkAtom";
import { pushToastAtom } from "./src/state/toastAtoms";
import {
  parsePanelLocationLink,
  type PanelLocation,
} from "@vibestudio/shared/panelLocation";

function AppContent() {
  const shellClient = useAtomValue(shellClientAtom);
  const directory = useAtomValue(workspaceDirectoryAtom);
  const [privacySection, setPrivacySection] =
    useState<MobileBrowserPrivacySection | null>(null);
  useEffect(() => {
    setPrivacySection(null);
    return shellClient?.onOpenBrowserPrivacy(setPrivacySection);
  }, [shellClient]);
  const isDark = useAtomValue(isDarkModeAtom);
  const colors = useAtomValue(themeColorsAtom);
  const setSystemColorScheme = useSetAtom(systemColorSchemeAtom);
  const hydrateThemePreference = useSetAtom(hydrateThemePreferenceAtom);
  const inboxDeepLinkSequence = useRef(0);
  const pushToast = useSetAtom(pushToastAtom);
  const consumedPanelLinks = useRef(new Set<string>());

  useHostUpdates();

  useEffect(() => {
    void hydrateThemePreference();
  }, [hydrateThemePreference]);

  // Track the system color scheme at the app root so the theme follows the OS
  // on every screen (login, settings, panels) — not only while MainScreen is
  // mounted.
  useEffect(() => {
    const subscription = Appearance.addChangeListener(
      ({ colorScheme: nextScheme }) => {
        setSystemColorScheme(nextScheme);
      },
    );
    return () => subscription.remove();
  }, [setSystemColorScheme]);

  useEffect(() => {
    if (!shellClient) return;
    const openLocation = async (location: PanelLocation) => {
      if (!directory)
        throw new Error("Your workspace directory is not connected");
      await directory.openPanelLocation(location);
    };
    const handleUrl = (raw: string) => {
      const parsed = parsePanelLocationLink(raw);
      if (parsed.kind !== "ok" || consumedPanelLinks.current.has(raw)) return;
      consumedPanelLinks.current.add(raw);
      void openLocation(parsed.location).catch((error: unknown) => {
        pushToast({
          title: "Panel link could not be opened",
          message: error instanceof Error ? error.message : String(error),
          tone: "danger",
        });
      });
    };
    return observePanelLinks(clientApi(), handleUrl);
  }, [pushToast, shellClient, directory]);

  useEffect(() => {
    if (!shellClient) return;
    let cleanup: (() => void) | null = null;
    let disposed = false;

    registerForPushNotifications(clientApi(), shellClient, {
      onApprovalDeepLink: (target) => {
        void directory?.openApproval(target).catch((error: unknown) =>
          pushToast({
            title: "Could not open approval",
            message: String(error),
            tone: "danger",
          }),
        );
      },
      onInboxDeepLink: (payload) => {
        if (!directory) return;
        void directory
          .resolveNotificationWorkspace(payload)
          .then(async (session) => {
            await directory.activate(payload.workspaceId);
            session.store.set(inboxDeepLinkAtom, {
              ...payload,
              sequence: (inboxDeepLinkSequence.current += 1),
            });
          })
          .catch((error: unknown) =>
            pushToast({
              title: "Could not open message",
              message: String(error),
              tone: "danger",
            }),
          );
      },
      onToast: (toast) => pushToast(toast),
    })
      .then((nextCleanup) => {
        if (disposed) {
          nextCleanup();
          return;
        }
        cleanup = nextCleanup;
      })
      .catch((error: unknown) => {
        console.warn("[App] Failed to initialize push notifications:", error);
        pushToast({
          durationMs: 7000,
          message: error instanceof Error ? error.message : String(error),
          title: "Push notifications unavailable",
          tone: "warning",
        });
      });

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [pushToast, directory, shellClient]);

  return (
    <>
      <StatusBar
        barStyle={isDark ? "light-content" : "dark-content"}
        translucent
        backgroundColor="transparent"
      />
      <ErrorBoundary label="App" colors={colors}>
        <NavigationContainer>
          <RootNavigator />
        </NavigationContainer>
        {shellClient && privacySection && (
          <BrowserPrivacyManager
            initialSection={privacySection}
            client={shellClient.browserPrivacy}
            onClose={() => setPrivacySection(null)}
          />
        )}
        <Toast />
        <ActionSheetHost />
      </ErrorBoundary>
    </>
  );
}

/** The client UI over an injected host API; tests supply a fake. */
export function ClientRoot({ api }: { api: RnClientApi }) {
  // Everything below reads the host API from the installed instance.
  useState(() => installClientApi(api));
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <JotaiProvider>
          <BrowserKitProvider>
            <AppContent />
          </BrowserKitProvider>
        </JotaiProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function App() {
  const [host, setHost] = useState<
    { api: RnClientApi } | { error: string } | null
  >(null);
  useEffect(() => {
    let active = true;
    connectNativeClientApi().then(
      (api) => active && setHost({ api }),
      (error: unknown) =>
        active &&
        setHost({ error: error instanceof Error ? error.message : String(error) }),
    );
    return () => {
      active = false;
    };
  }, []);
  if (!host) return null;
  if ("error" in host) {
    return (
      <View style={{ flex: 1, justifyContent: "center", padding: 24 }}>
        <Text>{host.error}</Text>
      </View>
    );
  }
  return <ClientRoot api={host.api} />;
}

AppRegistry.registerComponent(CLIENT_ROOT_COMPONENT, () => App);

export default App;
