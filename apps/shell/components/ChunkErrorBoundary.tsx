import { Component, type ReactNode, type ErrorInfo, useState } from "react";
import { Flex, Text, Button, Dialog } from "@radix-ui/themes";
import { ProblemReportingSection } from "./ProblemReporting";
import { useShellOverlay } from "../shell/useShellOverlay";
import { Surface, Stack } from "@workspace/ui/layout";

function ReportShellFailure({ error }: { error: Error }) {
  const [open, setOpen] = useState(false);
  useShellOverlay(open);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        Report this problem
      </Button>
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Content style={{ maxWidth: 900 }}>
          <Dialog.Title>Report a problem</Dialog.Title>
          <Dialog.Description>
            Review the shell failure and choose what to send to help improve
            Vibestudio.
          </Dialog.Description>
          <ProblemReportingSection
            initialSymptom={`The Vibestudio shell failed to load: ${error.message}`}
          />
          <Dialog.Close>
            <Button variant="outline">Close</Button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Root>
    </>
  );
}

interface Props {
  children: ReactNode;
  /** Called before re-rendering children — use to reset cached lazy components. */
  onRetry?: () => void;
}

interface State {
  error: Error | null;
}

/**
 * Error boundary for lazy-loaded chunks.
 * Shows a retry button when a chunk fails to load (e.g., network error, stale cache).
 *
 * Important: React.lazy caches rejected promises permanently, so callers must
 * pass an `onRetry` callback that reassigns the lazy component to get a fresh
 * import() attempt.
 */
export class ChunkErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(
      "[ChunkErrorBoundary] Failed to load chunk:",
      error,
      info.componentStack,
    );
  }

  handleRetry = () => {
    this.props.onRetry?.();
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      return (
        <Flex
          align="center"
          justify="center"
          style={{
            height: "100dvh",
            padding: "var(--space-5)",
            background: "var(--surface-panel)",
          }}
        >
          <Surface
            level="raised"
            elevation={2}
            bordered
            padding="5"
            style={{ maxWidth: 420, width: "100%" }}
          >
            <Stack gap="3" align="center">
              <Text
                size="3"
                weight="medium"
                style={{ color: "var(--intent-error)" }}
              >
                Failed to load application
              </Text>
              <Text size="2" color="gray" align="center">
                {this.state.error.message}
              </Text>
              <Button
                variant="soft"
                className="app-touch-target"
                onClick={this.handleRetry}
              >
                Retry
              </Button>
              <ReportShellFailure error={this.state.error} />
            </Stack>
          </Surface>
        </Flex>
      );
    }

    return this.props.children;
  }
}
