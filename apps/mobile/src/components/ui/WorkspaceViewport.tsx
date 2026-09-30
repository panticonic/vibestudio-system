import { KeyboardAvoidingView, Platform, type ViewProps } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

/** The native workspace header owns the top inset; this boundary owns the
 * remaining edges and measures them again when the keyboard resizes the view. */
export function WorkspaceViewport({ children, style, ...props }: ViewProps) {
  return (
    <KeyboardAvoidingView
      {...props}
      style={[{ flex: 1 }, style]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <SafeAreaProvider>
        <SafeAreaView edges={["left", "right", "bottom"]} style={{ flex: 1 }}>
          {children}
        </SafeAreaView>
      </SafeAreaProvider>
    </KeyboardAvoidingView>
  );
}
