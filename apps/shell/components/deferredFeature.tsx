import { createElement, lazy, Suspense, useState, type FunctionComponent } from "react";
import { Text } from "@radix-ui/themes";
import { ChunkErrorBoundary } from "./ChunkErrorBoundary";

/** One operation-owned lazy component, with a fresh import attempt on retry. */
export function deferredFeature<Props extends object>(
  load: () => Promise<{ default: FunctionComponent<Props> }>
): FunctionComponent<Props> {
  return function DeferredFeature(props) {
    const [Feature, setFeature] = useState(() => lazy(load));
    return (
      <ChunkErrorBoundary onRetry={() => setFeature(() => lazy(load))}>
        <Suspense fallback={<Text role="status">Loading…</Text>}>
          {createElement(Feature, props)}
        </Suspense>
      </ChunkErrorBoundary>
    );
  };
}
