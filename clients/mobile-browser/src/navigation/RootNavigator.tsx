import type { SettingsSection } from "@vibestudio/shared/shellSurface";
import { createStackNavigator } from "@workspace/mobile-navigation";
import { ConnectScreen } from "../components/ConnectScreen";

declare const require: (moduleName: string) => unknown;

export type RootStackParamList = {
  Connect: undefined;
  Main: undefined;
  Settings: { workspaceId?: string; section?: SettingsSection } | undefined;
};

const Stack = createStackNavigator<RootStackParamList>();

// Connect is the first-paint route. React Navigation's getComponent boundary
// keeps the much larger authenticated shell (drawer, WebViews, panel bridge)
// and settings screen from being evaluated until the user actually opens them.
const getMainNavigator = () =>
  (
    require("./MainNavigator") as {
      MainNavigator: typeof import("./MainNavigator").MainNavigator;
    }
  ).MainNavigator;
const getSettingsScreen = () =>
  (
    require("../components/SettingsScreen") as {
      SettingsScreen: typeof import("../components/SettingsScreen").SettingsScreen;
    }
  ).SettingsScreen;

export function RootNavigator() {
  return (
    <Stack.Navigator
      initialRouteName="Connect"
      screenOptions={{ headerShown: false }}
    >
      <Stack.Screen name="Connect" component={ConnectScreen} />
      <Stack.Screen name="Main" getComponent={getMainNavigator} />
      <Stack.Screen name="Settings" getComponent={getSettingsScreen} />
    </Stack.Navigator>
  );
}
