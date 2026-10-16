import type { Panel } from "@vibestudio/shared/types";
import type {
  PanelRuntimeAcquireResult,
  PanelRuntimeLease,
} from "@vibestudio/shared/panel/panelLease";
import { asPanelEntityId } from "@vibestudio/shared/panel/ids";
import {
  materializeLatestMobilePanel,
  materializeMobilePanel,
  mobilePanelMaterializationState,
  needsMobilePanelMaterialization,
  PanelMaterializationTasks,
  PanelMaterializationLifetime,
} from "./panelMaterializer";

const hostConfig = {
  protocol: "https",
  host: "vibestudio.example.com",
  port: "3000",
  basePath: "/_workspace/dev",
};

function makePanel(source: string): Panel {
  return {
    id: "panel-1",
    title: "Panel 1",
    runtimeEntityId: "panel:nav-1",
    buildKey: "b".repeat(64),
    children: [],
    snapshot: {
      source,
      contextId: "ctx-panel-1",
      options: {},
    },
    artifacts: { buildState: "ready" },
  };
}

function makeLease(
  overrides: Partial<PanelRuntimeLease> = {},
): PanelRuntimeLease {
  return {
    slotId: "panel-1" as PanelRuntimeLease["slotId"],
    runtimeEntityId: asPanelEntityId("panel:nav-1"),
    clientSessionId: "mobile-device",
    hostConnectionId: "mobile-device",
    connectionId: "authoritative-connection",
    holderLabel: "Mobile",
    platform: "mobile",
    supportsCdp: false,
    loadOnLeaseAssignment: false,
    acquiredAt: 1,
    ...overrides,
  };
}

function makeDeps(overrides?: {
  panelInit?: unknown;
  acquireResult?: PanelRuntimeAcquireResult;
}) {
  return {
    lifetime: new PanelMaterializationLifetime(),
    getPanelInit: jest.fn(
      async () => overrides?.panelInit ?? { entityId: "panel:nav-1" },
    ),
    acquireLease: jest.fn(
      async (_panelId: string, runtimeEntityId: string) =>
        overrides?.acquireResult ?? {
          acquired: true,
          version: { epoch: "test", counter: 1 },
          lease: makeLease({
            runtimeEntityId: asPanelEntityId(runtimeEntityId),
            connectionId: "retained-connection",
          }),
        },
    ),
    takeOverLease: jest.fn(
      async (_panelId: string, runtimeEntityId: string) =>
        overrides?.acquireResult ?? {
          acquired: true,
          version: { epoch: "test", counter: 1 },
          lease: makeLease({
            runtimeEntityId: asPanelEntityId(runtimeEntityId),
            connectionId: "retained-connection",
          }),
        },
    ),
  };
}

describe("needsMobilePanelMaterialization", () => {
  it("waits for a build identity before completing a reserved WebView", () => {
    const panel = makePanel("panels/editor");
    panel.buildKey = null;

    expect(
      mobilePanelMaterializationState(panel, {
        url: "about:blank",
        runtimeEntityId: "panel:nav-1",
      }),
    ).toBe("pending");
    expect(
      needsMobilePanelMaterialization(panel, {
        url: "about:blank",
        runtimeEntityId: "panel:nav-1",
      }),
    ).toBe(false);
  });

  it("waits for a runtime identity instead of treating the placeholder as current", () => {
    const panel = makePanel("panels/editor");
    panel.runtimeEntityId = null;

    expect(
      mobilePanelMaterializationState(panel, {
        url: "about:blank",
        runtimeEntityId: null,
      }),
    ).toBe("pending");
  });

  it("materializes reserved WebViews regardless of visibility", () => {
    expect(
      mobilePanelMaterializationState(makePanel("panels/editor"), {
        url: "about:blank",
        runtimeEntityId: "panel:nav-1",
      }),
    ).toBe("needed");
    expect(
      needsMobilePanelMaterialization(makePanel("panels/editor"), {
        url: "about:blank",
        runtimeEntityId: "panel:nav-1",
      }),
    ).toBe(true);
  });

  it("rematerializes a retained WebView when navigation publishes a new runtime entity", () => {
    const panel = makePanel("panels/chat");
    panel.runtimeEntityId = "panel:nav-2";

    expect(
      needsMobilePanelMaterialization(panel, {
        url: "http://127.0.0.1/panels/editor/",
        runtimeEntityId: "panel:nav-1",
      }),
    ).toBe(true);
    expect(
      needsMobilePanelMaterialization(panel, {
        url: "http://127.0.0.1/panels/chat/",
        runtimeEntityId: "panel:nav-2",
      }),
    ).toBe(false);
    expect(
      mobilePanelMaterializationState(panel, {
        url: "http://127.0.0.1/panels/chat/",
        runtimeEntityId: "panel:nav-2",
      }),
    ).toBe("current");
  });

  it("rematerializes browser WebViews without requiring a workspace build", () => {
    const panel = makePanel("browser:https://example.com/next");
    panel.buildKey = null;
    panel.runtimeEntityId = "panel:nav-browser-next";

    expect(
      needsMobilePanelMaterialization(panel, {
        url: "https://example.com/current",
        runtimeEntityId: "panel:nav-browser-current",
      }),
    ).toBe(true);
    expect(
      needsMobilePanelMaterialization(panel, {
        url: "https://example.com/next",
        runtimeEntityId: "panel:nav-browser-next",
      }),
    ).toBe(false);
  });
});

describe("materializeMobilePanel", () => {
  it("does not acquire a lease after retirement and preserves the cancellation cause", async () => {
    const deps = makeDeps();
    let finish!: (value: { entityId: string }) => void;
    deps.getPanelInit.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const lifetime = deps.lifetime;
    const pending = materializeMobilePanel({
      panelId: "panel-1",
      panel: makePanel("panels/editor"),
      hostConfig,
      ...deps,
      leaseMode: "acquire",
      lifetime,
    });
    const cause = new Error("Panel presentation retired");
    const rejected = expect(pending).rejects.toBe(cause);
    lifetime.retire(cause);
    lifetime.retire(new Error("A later retirement must not replace the cause"));
    finish({ entityId: "panel:nav-1" });
    await rejected;
    expect(deps.acquireLease).not.toHaveBeenCalled();
  });
  it("leases a reserved panel and returns an immediate blank WebView without requesting a grant", async () => {
    const deps = makeDeps();
    const panel = makePanel("panels/editor");
    panel.buildKey = null;
    panel.artifacts = { buildState: "pending" };

    await expect(
      materializeMobilePanel({
        panelId: "panel-1",
        panel,
        hostConfig,
        ...deps,
        leaseMode: "acquire",
      }),
    ).resolves.toEqual({
      panelId: "panel-1",
      runtimeEntityId: "panel:nav-1",
      connectionId: "retained-connection",
      url: "about:blank",
      managed: true,
      panelInit: null,
    });
    expect(deps.getPanelInit).not.toHaveBeenCalled();
    expect(deps.acquireLease).toHaveBeenCalledWith("panel-1", "panel:nav-1");
  });

  it("acquires a mobile runtime lease for browser panels before returning the browser URL", async () => {
    const deps = makeDeps();

    const result = await materializeMobilePanel({
      panelId: "panel-1",
      panel: makePanel("browser:https://example.com/docs"),
      hostConfig,
      ...deps,
      leaseMode: "acquire",
    });

    expect(result).toEqual({
      panelId: "panel-1",
      runtimeEntityId: "panel:nav-1",
      connectionId: "retained-connection",
      url: "https://example.com/docs",
      managed: false,
      panelInit: null,
    });
    expect(deps.getPanelInit).toHaveBeenCalledWith("panel-1");
    expect(deps.acquireLease).toHaveBeenCalledWith("panel-1", "panel:nav-1");
    expect(deps.takeOverLease).not.toHaveBeenCalled();
  });

  it("uses takeover mode when materializing browser panels during mobile takeover", async () => {
    const deps = makeDeps();

    await materializeMobilePanel({
      panelId: "panel-1",
      panel: makePanel("browser:https://example.com"),
      hostConfig,
      ...deps,
      leaseMode: "takeOver",
    });

    expect(deps.takeOverLease).toHaveBeenCalledWith("panel-1", "panel:nav-1");
    expect(deps.acquireLease).not.toHaveBeenCalled();
  });

  it("rejects browser panel materialization when another client holds the lease", async () => {
    const deps = makeDeps({
      acquireResult: {
        acquired: false,
        version: { epoch: "test", counter: 1 },
        lease: makeLease({ holderLabel: "Desktop" }),
      },
    });

    await expect(
      materializeMobilePanel({
        panelId: "panel-1",
        panel: makePanel("browser:https://example.com"),
        hostConfig,
        ...deps,
        leaseMode: "acquire",
      }),
    ).rejects.toThrow("Panel panel-1 is running on Desktop");
  });

  it("keeps managed panel materialization payloads lease-bound", async () => {
    const deps = makeDeps({
      panelInit: { entityId: "panel:nav-1", slotId: "panel-1" },
      acquireResult: {
        acquired: true,
        version: { epoch: "test", counter: 1 },
        lease: makeLease({ connectionId: "recovered-connection" }),
      },
    });

    const result = await materializeMobilePanel({
      panelId: "panel-1",
      panel: makePanel("panels/editor"),
      hostConfig,
      ...deps,
      leaseMode: "acquire",
    });

    expect(result).toMatchObject({
      panelId: "panel-1",
      // Mobile serves panels through the local asset façade (127.0.0.1:<port>) over
      // the authenticated Iroh session, not the remote host directly.
      url: `http://127.0.0.1:3000/_workspace/dev/panels/editor/?contextId=ctx-panel-1&buildKey=${"b".repeat(64)}`,
      managed: true,
      panelInit: {
        entityId: "panel:nav-1",
        slotId: "panel-1",
        clientLabel: "Mobile",
        connectionId: "recovered-connection",
      },
    });
  });

  it("rejects a panel init from a different runtime before acquiring its lease", async () => {
    const deps = makeDeps({ panelInit: { entityId: "panel:nav-2" } });

    await expect(
      materializeMobilePanel({
        panelId: "panel-1",
        panel: makePanel("panels/editor"),
        hostConfig,
        ...deps,
        leaseMode: "acquire",
      }),
    ).rejects.toThrow("changed runtime identity");
    expect(deps.acquireLease).not.toHaveBeenCalled();
  });

  it("restarts from the latest panel when navigation lands during materialization", async () => {
    let currentPanel: Panel | null = makePanel("panels/editor");
    const nextPanel = makePanel("panels/chat");
    nextPanel.runtimeEntityId = "panel:nav-2";
    const deps = makeDeps();
    deps.getPanelInit
      .mockImplementationOnce(async () => {
        currentPanel = nextPanel;
        return { entityId: "panel:nav-2" };
      })
      .mockImplementationOnce(async () => ({ entityId: "panel:nav-2" }));

    const result = await materializeLatestMobilePanel({
      panelId: "panel-1",
      getPanel: () => currentPanel,
      hostConfig,
      ...deps,
      leaseMode: "acquire",
    });

    expect(result).toMatchObject({
      runtimeEntityId: "panel:nav-2",
      url: `http://127.0.0.1:3000/_workspace/dev/panels/chat/?contextId=ctx-panel-1&buildKey=${"b".repeat(64)}`,
      panelInit: { entityId: "panel:nav-2" },
    });
    expect(deps.acquireLease).toHaveBeenCalledTimes(1);
    expect(deps.acquireLease).toHaveBeenCalledWith("panel-1", "panel:nav-2");
  });
});

describe("PanelMaterializationTasks", () => {
  it("retains a slow operation without retries until the real work completes", async () => {
    jest.useFakeTimers();
    try {
      let complete!: () => void;
      const settled = jest.fn();
      const tasks = new PanelMaterializationTasks(settled);
      const work = jest.fn(
        () =>
          new Promise<void>((resolve) => {
            complete = resolve;
          }),
      );
      const pending = tasks.start(
        "panel-1",
        () => "runtime-1",
        "acquire",
        work,
      )!;
      await Promise.resolve();
      jest.advanceTimersByTime(180_000);
      expect(tasks.has("panel-1")).toBe(true);
      expect(
        tasks.start("panel-1", () => "runtime-2", "takeOver", work),
      ).toBeNull();
      expect(work).toHaveBeenCalledTimes(1);
      expect(settled).not.toHaveBeenCalled();
      complete();
      await pending;
      expect(tasks.has("panel-1")).toBe(false);
      expect(settled).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it("preserves the original failure and waits for an explicit retry or new incarnation", async () => {
    const cause = new Error("Original connection grant failure");
    const tasks = new PanelMaterializationTasks(jest.fn());
    const work = jest.fn(async () => {
      throw cause;
    });
    await expect(
      tasks.start("panel-1", () => "runtime-1", "acquire", work),
    ).rejects.toBe(cause);
    expect(
      tasks.start("panel-1", () => "runtime-1", "acquire", work),
    ).toBeNull();
    expect(work).toHaveBeenCalledTimes(1);
    tasks.retry("panel-1");
    await expect(
      tasks.start("panel-1", () => "runtime-1", "acquire", work),
    ).rejects.toBe(cause);
    await expect(
      tasks.start(
        "panel-1",
        () => "runtime-2",
        "acquire",
        async () => {},
      ),
    ).resolves.toBeUndefined();
  });

  it("cancels a retired slot and joins it before permitting its replacement", async () => {
    let complete!: () => void;
    let lifetime!: PanelMaterializationLifetime;
    const tasks = new PanelMaterializationTasks(jest.fn());
    const pending = tasks.start(
      "panel-1",
      () => "runtime-1",
      "takeOver",
      (ownedLifetime) => {
        lifetime = ownedLifetime;
        return new Promise<void>((resolve) => {
          complete = resolve;
        });
      },
    )!;
    await Promise.resolve();
    expect(tasks.isTakingOver("panel-1")).toBe(true);
    const joined = jest.fn();
    const stopped = tasks.stop().then(joined);
    await Promise.resolve();
    expect(lifetime.retired).toBe(true);
    expect(() => lifetime.assertActive()).toThrow("Panel panel-1 is no longer retained");
    expect(joined).not.toHaveBeenCalled();
    expect(tasks.has("panel-1")).toBe(true);
    expect(
      tasks.start(
        "panel-1",
        () => "runtime-2",
        "acquire",
        async () => {},
      ),
    ).toBeNull();
    complete();
    await Promise.all([pending, stopped]);
    expect(joined).toHaveBeenCalledTimes(1);
    await expect(
      tasks.start(
        "panel-1",
        () => "runtime-2",
        "acquire",
        async () => {},
      ),
    ).resolves.toBeUndefined();
  });

  it("records a failure against the incarnation reached during navigation", async () => {
    let coordinate = "runtime-1";
    let fail!: (cause: Error) => void;
    const cause = new Error("New runtime grant failed");
    const tasks = new PanelMaterializationTasks(jest.fn());
    const pending = tasks.start(
      "panel-1",
      () => coordinate,
      "acquire",
      () =>
        new Promise<void>((_, reject) => {
          fail = reject;
        }),
    )!;
    const rejected = expect(pending).rejects.toBe(cause);
    await Promise.resolve();
    coordinate = "runtime-2";
    fail(cause);
    await rejected;
    expect(
      tasks.start(
        "panel-1",
        () => coordinate,
        "acquire",
        async () => {},
      ),
    ).toBeNull();
  });
});
