import {
  MOBILE_PANEL_PROJECTION_EVENTS,
  reconcileWatchedPanelProjection,
} from "./watchedPanelProjection";

it("watches every event that can replace or terminate a panel incarnation", () => {
  expect(MOBILE_PANEL_PROJECTION_EVENTS).toEqual([
    "panel:runtimeLeaseChanged",
    "panel-tree-invalidated",
    "panel-presentation-changed",
    "panel:executionActivated",
    "panel:executionFailed",
  ]);
});

it("admits the event watch before reconciling the authoritative panel projection", async () => {
  let projected = "pending";
  let revision = 0;
  let reads = 0;
  let activated: (() => void) | null = null;
  const subscribe = jest.fn(async () => {
    activated = () => {
      revision += 1;
      projected = "ready";
    };
  });
  const reconcile = jest.fn(async () => {
    // This is the production race: activation lands after first paint while
    // the post-paint reconciliation is in flight. Its stale response lands
    // after the event; the generation guard must perform a second read.
    reads += 1;
    if (reads === 1) {
      activated?.();
      projected = "pending";
    } else {
      projected = "ready";
    }
  });

  await reconcileWatchedPanelProjection({
    subscribe,
    revision: () => revision,
    reconcile,
  });

  expect(subscribe).toHaveBeenCalledWith(MOBILE_PANEL_PROJECTION_EVENTS);
  expect(reconcile).toHaveBeenCalledTimes(2);
  expect(subscribe.mock.invocationCallOrder[0]).toBeLessThan(
    reconcile.mock.invocationCallOrder[0]!,
  );
  expect(projected).toBe("ready");
});

it("does not begin the snapshot when watch admission fails", async () => {
  const failure = new Error("event watch unavailable");
  const reconcile = jest.fn(async () => undefined);

  await expect(
    reconcileWatchedPanelProjection({
      subscribe: async () => {
        throw failure;
      },
      revision: () => 0,
      reconcile,
    }),
  ).rejects.toBe(failure);

  expect(reconcile).not.toHaveBeenCalled();
});
