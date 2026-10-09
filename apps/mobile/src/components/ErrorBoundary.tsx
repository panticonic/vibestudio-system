/**
 * ErrorBoundary -- Top-level error boundary for the Vibestudio mobile app.
 *
 * Catches unhandled React render errors and shows a recovery screen
 * instead of crashing the entire app. Colors come from the
 * caller's resolved theme so the screen matches light and dark modes.
 */

import React, { type ErrorInfo, type ReactNode } from "react";
import { View, Text, ScrollView, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { EmptyState, Button } from "./ui/primitives";
import type { ThemeColors } from "../state/themeAtoms";
import { AlertTriangle, RefreshCw } from "../design/icons";

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Optional label shown in the error screen (e.g. "App" or "Panel") */
  label?: string;
  /** Resolved theme colors for the error screen (the theme atoms may be unavailable in the error state). */
  colors: Pick<
    ThemeColors,
    "background" | "textTertiary" | "danger" | "codeBackground" | "border"
  >;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  /** Bumped on retry so the children remount from scratch instead of re-rendering stale state. */
  resetKey: number;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, resetKey: 0 };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error(
      `[ErrorBoundary${this.props.label ? `:${this.props.label}` : ""}] Uncaught error:`,
      error,
      errorInfo.componentStack
    );
  }

  private handleRetry = () => {
    this.setState((prev) => ({ hasError: false, error: null, resetKey: prev.resetKey + 1 }));
  };

  render() {
    if (this.state.hasError) {
      const { error } = this.state;
      const label = this.props.label ?? "App";
      const colors = this.props.colors;

      return (
        <SafeAreaView
          style={[styles.container, { backgroundColor: colors.background }]}
        >
          <View style={styles.content}>
            <EmptyState
              icon={AlertTriangle}
              title="Something went wrong"
              message={`${label} encountered an unexpected error.`}
              action={
                <Button
                  label="Retry"
                  variant="filled"
                  icon={RefreshCw}
                  onPress={this.handleRetry}
                />
              }
            />
            {error?.message ? (
              <Text style={[styles.errorMessage, { color: colors.danger }]}>
                {error.message}
              </Text>
            ) : null}

            {__DEV__ && error?.stack ? (
              <ScrollView
                style={[
                  styles.stackContainer,
                  { backgroundColor: colors.codeBackground, borderColor: colors.border },
                ]}
              >
                <Text style={[styles.stackText, { color: colors.textTertiary }]}>
                  {error.stack}
                </Text>
              </ScrollView>
            ) : null}
          </View>
        </SafeAreaView>
      );
    }

    return <React.Fragment key={this.state.resetKey}>{this.props.children}</React.Fragment>;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    padding: 32,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    width: "100%",
    maxWidth: 400,
  },
  errorMessage: {
    fontSize: 13,
    textAlign: "center",
    marginTop: 16,
    marginBottom: 24,
    lineHeight: 20,
  },
  stackContainer: {
    maxHeight: 200,
    width: "100%",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    padding: 12,
  },
  stackText: {
    fontSize: 11,
    fontFamily: "monospace",
  },
});
