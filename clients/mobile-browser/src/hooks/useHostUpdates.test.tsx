import { Alert } from "react-native";
import { renderHook } from "@testing-library/react-native";
import { Provider, createStore } from "jotai";
import type { ReactNode } from "react";
import type { SupervisionChange } from "@vibestudio/shared/events";
import { installClientApi } from "@workspace/client-kit-native/host";
import { createFakeClientHost } from "@workspace/client-kit-native/testing";
import { useHostUpdates } from "./useHostUpdates";

function change(buildKey: string): SupervisionChange {
  return {
    identity: { kind: "client", entityId: "browser" },
    source: "clients/mobile-browser",
    status: "running",
    lastError: null,
    artifact: { effectiveVersion: "1.2.0", buildKey, executionDigest: null },
    canRollback: false,
    change: "adopted",
    previousBuildKey: "build-1",
    previousEffectiveVersion: "1.1.0",
    client: { id: "browser", runtime: "react-native", grantedCapabilities: [] },
  };
}

it("asks about a build the host announces and restarts through the host when chosen", async () => {
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
  const fake = await createFakeClientHost();
  installClientApi(fake.api);
  const store = createStore();
  const view = renderHook(() => useHostUpdates(), {
    wrapper: ({ children }: { children: ReactNode }) => <Provider store={store}>{children}</Provider>,
  });

  fake.emit({
    type: "update",
    update: {
      buildKey: "build-2",
      effectiveVersion: "1.2.0",
      previousBuildKey: "build-1",
      change: change("build-2"),
    },
  });
  expect(alert).toHaveBeenCalledTimes(1);
  const install = alert.mock.calls[0]![2]!.find((button) => button.text === "Install");
  install!.onPress!();
  await Promise.resolve();
  await Promise.resolve();
  expect(fake.callsOf("updates.restartAtSafePoint")).toHaveLength(1);

  view.unmount();
  fake.emit({
    type: "update",
    update: {
      buildKey: "build-3",
      effectiveVersion: "1.3.0",
      previousBuildKey: "build-2",
      change: change("build-3"),
    },
  });
  expect(alert).toHaveBeenCalledTimes(1);
  alert.mockRestore();
});
