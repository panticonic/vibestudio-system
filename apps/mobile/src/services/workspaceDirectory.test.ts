import {
  connectionStatusAtom,
  workspaceReadinessAtom,
} from "../state/connectionAtoms";
import type { PendingApproval } from "@vibestudio/shared/approvals";
import { MobileWorkspaceDirectory } from "./workspaceDirectory";
import { activePanelIdAtom } from "../state/navigationAtoms";
import { shellClientAtom } from "../state/shellClientAtom";
import type {
  StoredMobileConnection,
  MobileWorkspaceAccount,
} from "@vibestudio/mobile-iroh";

const mockClients: Array<{ config: Record<string, any>; client: any }> = [];
const mockOpening = new Map<string, Promise<void>>();
const mockRecoveryHandlers = new Map<
  string,
  { resubscribe?: () => Promise<void>; coldRecover?: () => Promise<void> }
>();
const mockHubEventListeners = new Map<
  string,
  (payload: { workspaces: Array<Record<string, any>> }) => void
>();
jest.mock("./shellClient", () => ({
  ShellClient: jest.fn().mockImplementation((config) => {
    const client = {
      workspaceId: config["workspaceId"],
      workspaceName: config.workspaceName,
      transport: {
        status: "connected",
        serverId: "srv_aaaaaaaaaaaaaaaaaaaaaaaa",
      },
      hostLaunch: config["appSourceClient"]?.hostLaunch ?? {
        source: "apps/mobile",
      },
      events: {
        subscribe: jest.fn(async () => undefined),
        unsubscribe: jest.fn(async () => undefined),
        on: jest.fn(() => () => {}),
      },
      shellApproval: { listPending: jest.fn(async () => []) },
      recovery: {
        registerResubscribeHandler: jest.fn(
          (_name: string, handler: () => Promise<void>) => {
            const handlers = mockRecoveryHandlers.get(config.workspaceId) ?? {};
            handlers.resubscribe = handler;
            mockRecoveryHandlers.set(config.workspaceId, handlers);
            return () => {
              if (handlers.resubscribe === handler) delete handlers.resubscribe;
            };
          },
        ),
        registerColdRecoverHandler: jest.fn(
          (_name: string, handler: () => Promise<void>) => {
            const handlers = mockRecoveryHandlers.get(config.workspaceId) ?? {};
            handlers.coldRecover = handler;
            mockRecoveryHandlers.set(config.workspaceId, handlers);
            return () => {
              if (handlers.coldRecover === handler) delete handlers.coldRecover;
            };
          },
        ),
      },
      serverUrl: `http://localhost/${config["workspaceId"]}`,
      init: jest.fn(async () => {
        await config.connectWorkspace(() => undefined);
        await mockOpening.get(config["workspaceId"]);
      }),
      close: jest.fn(async () => undefined),
      dispose: jest.fn(),
      refreshAccountProfile: jest.fn(async () => ({ userId: "alice" })),
      panels: {
        registry: { getFocusedPanelId: jest.fn(() => "destination-focused") },
        navigatePanel: jest.fn(async () => ({ id: "destination-focused" })),
        createChildPanel: jest.fn(async () => ({ id: "destination-child" })),
        focus: jest.fn(async () => undefined),
        createAboutPanel: jest.fn(async () => ({ id: "new-panel" })),
        createRootPanel: jest.fn(async () => ({ id: "destination-panel" })),
      },
    };
    mockClients.push({ config, client });
    return client;
  }),
}));
jest.mock("@vibestudio/mobile-iroh", () => ({
  connectMobileAccount: jest.fn(),
  MobileConnectionAggregateError: AggregateError,
}));
jest.mock("@vibestudio/service-schemas/clients/eventsClient", () => ({
  EventsClient: jest.fn().mockImplementation(() => ({
    subscribe: jest.fn(async () => undefined),
    unsubscribe: jest.fn(async () => undefined),
    unsubscribeAll: jest.fn(async () => undefined),
    on: jest.fn(
      (
        event: string,
        listener: (payload: { workspaces: Array<Record<string, any>> }) => void,
      ) => {
        mockHubEventListeners.set(event, listener);
        return () => mockHubEventListeners.delete(event);
      },
    ),
  })),
}));

const entries = [
  {
    workspaceId: "system",
    name: "System",
    privateRole: "system",
    running: true,
    lastOpened: 0,
    pendingApprovalCount: 0,
  },
  {
    workspaceId: "personal",
    name: "Personal",
    privateRole: "personal",
    running: true,
    lastOpened: 0,
    pendingApprovalCount: 0,
  },
  {
    workspaceId: "project",
    name: "Project",
    running: false,
    lastOpened: 0,
    pendingApprovalCount: 0,
  },
];
function workspace(privateRole: "personal" | "system") {
  const entry = entries.find(
    (candidate) => candidate.privateRole === privateRole,
  );
  if (!entry) throw new Error(`Missing ${privateRole} workspace fixture`);
  return structuredClone(entry);
}
function fixture() {
  const account = {
    control: {
      rpc: {
        call: jest.fn(async (_target, method: { name: string }) => {
          if (method.name === "hubControl.ensureUserWorkspaces")
            return {
              personal: workspace("personal"),
              system: workspace("system"),
            };
          if (method.name === "shellApproval.listPending") return [];
          return structuredClone(entries);
        }),
      },
    },
    openWorkspace: jest.fn(
      async (_workspaceId: string, _onRecovery?: unknown) => ({}),
    ),
    close: jest.fn(async () => undefined),
  };
  const stored = {
    controlPairing: { endpointId: "a".repeat(64) },
    credential: { deviceId: "device-a" },
  };
  const directory = new MobileWorkspaceDirectory(
    account as unknown as MobileWorkspaceAccount,
    stored as StoredMobileConnection,
  );
  return { directory, account };
}

beforeEach(() => {
  mockClients.length = 0;
  mockOpening.clear();
  mockRecoveryHandlers.clear();
  mockHubEventListeners.clear();
});

describe("mobile workspace directory", () => {
  it("never applies a catalog read superseded by the admitted snapshot", async () => {
    const { directory, account } = fixture();
    await directory.init();
    let resolveStaleCatalog!: (value: typeof entries) => void;
    let catalogReads = 0;
    const currentEntries = entries.map((entry) =>
      entry.workspaceId === "project"
        ? { ...entry, name: "Renamed project", running: true }
        : entry,
    );
    jest
      .mocked(account.control.rpc.call)
      .mockImplementation(async (_target, method: { name: string }) => {
        if (method.name === "shellApproval.listPending") return [];
        catalogReads += 1;
        if (catalogReads === 1) {
          return new Promise<typeof entries>((resolve) => {
            resolveStaleCatalog = resolve;
          });
        }
        return structuredClone(currentEntries);
      });
    const publishedProjectNames: string[] = [];
    directory.subscribe(() => {
      const project = directory.entries.find(
        ({ workspaceId }) => workspaceId === "project",
      );
      if (project) publishedProjectNames.push(project.name);
    });

    const refreshing = directory.refresh();
    while (catalogReads === 0) await Promise.resolve();
    mockHubEventListeners.get("hub:workspace-catalog-changed")!({
      workspaces: structuredClone(currentEntries),
    });
    resolveStaleCatalog(structuredClone(entries));
    await refreshing;

    expect(catalogReads).toBe(2);
    expect(publishedProjectNames).toContain("Renamed project");
    expect(publishedProjectNames).not.toContain("Project");
    expect(
      directory.entries.find(({ workspaceId }) => workspaceId === "project"),
    ).toMatchObject({ name: "Renamed project", running: true });
    await directory.dispose();
  });

  it("does not report phone setup complete until the visible workspace reconciles", async () => {
    const { directory } = fixture();
    try {
      expect(directory.phoneSetupReadiness().status).toBe("opening");
      await directory.init();
      const visible = directory.sessions.get(directory.activeWorkspaceId!)!;
      visible.store.set(connectionStatusAtom, "connected");
      visible.store.set(workspaceReadinessAtom, "shell-ready");
      expect(directory.phoneSetupReadiness().status).toBe("opening");
      visible.store.set(workspaceReadinessAtom, "reconciled");
      expect(directory.phoneSetupReadiness().status).toBe("ready");
      visible.store.set(connectionStatusAtom, "disconnected");
      expect(directory.phoneSetupReadiness().status).toBe("opening");
      visible.store.set(workspaceReadinessAtom, "failed");
      expect(directory.phoneSetupReadiness().status).toBe("failed");
    } finally {
      await directory.dispose();
    }
  });
  it("resolves a workspace role and retains destination state without touching the source tree", async () => {
    const { directory } = fixture();
    try {
      await directory.init();
      const personal = directory.sessions.get("personal")!;
      await directory.openPanelLocation({
        source: "about/automations",
        workspace: { role: "system" },
        stateArgs: { tab: "active" },
        focus: false,
      });
      const system = directory.sessions.get("system")!;
      expect(system.client.panels.createRootPanel).toHaveBeenCalledWith(
        "about/automations",
        expect.objectContaining({ stateArgs: { tab: "active" }, focus: false }),
      );
      expect(personal.client.panels.createRootPanel).not.toHaveBeenCalled();
      expect(directory.activeWorkspaceId).toBe("system");
      await directory.openPanelLocation({
        source: "panels/chat",
        workspace: "Project",
        disposition: "child",
        contextId: "target-context",
      });
      expect(
        directory.sessions.get("project")!.client.panels.createChildPanel,
      ).toHaveBeenCalledWith(
        "destination-focused",
        "panels/chat",
        expect.objectContaining({ contextId: "target-context" }),
      );
      await expect(
        directory.openPanelLocation({
          source: "panels/chat",
          workspace: { id: "missing" },
        }),
      ).rejects.toThrow("unavailable");
      expect(directory.activeWorkspaceId).toBe("project");
    } finally {
      await directory.dispose();
    }
  });
  it("merges hub approvals without creating a fake workspace session", async () => {
    const { directory, account } = fixture();
    await directory.init();
    const request = {
      approvalId: "hub-review",
      callerId: "hub-control",
      callerKind: "worker" as const,
      repoPath: "workers/account-task",
      effectiveVersion: "v1",
      requestedByUserId: "alice",
      requestedAt: 1,
      kind: "capability" as const,
      capability: "account.manage",
      title: "Manage account",
    };
    (account.control.rpc.call as jest.Mock).mockImplementation(
      async (_target, method) => {
        if (method.name === "hubControl.ensureUserWorkspaces")
          return {
            personal: workspace("personal"),
            system: workspace("system"),
          };
        if (method.name === "shellApproval.listPending") return [request];
        return structuredClone(entries);
      },
    );

    await directory.hubApproval.approvalState!.refresh("manual");

    expect(directory.approvalItems).toEqual([
      expect.objectContaining({
        owner: { kind: "hub" },
        approvalId: "hub-review",
      }),
    ]);
    expect(directory.selectedApprovalOwner).toBe(directory.hubApproval);
    expect(directory.approvalCount).toBe(1);
    expect(directory.sessions.has("hub")).toBe(false);
    await directory.dispose();
  });

  it("retains a visible account queue error until a successful refresh", async () => {
    const { directory, account } = fixture();
    const warn = jest
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    await directory.init();
    jest
      .mocked(account.control.rpc.call)
      .mockRejectedValueOnce(new Error("account queue unavailable"));
    await expect(
      directory.hubApproval.approvalState!.refresh("manual"),
    ).rejects.toThrow("account queue unavailable");
    expect(directory.approvalOwnerErrors).toEqual([
      "Account: account queue unavailable",
    ]);
    expect(directory.failedApprovalOwners).toEqual([directory.hubApproval]);
    jest.mocked(account.control.rpc.call).mockResolvedValueOnce([]);
    await directory.retryFailedApprovalOwners();
    expect(directory.approvalOwnerErrors).toEqual([]);
    expect(directory.failedApprovalOwners).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      "[WorkspaceDirectory] Account approval refresh:manual failed",
      expect.any(Error),
    );
    warn.mockRestore();
    await directory.dispose();
  });

  it("retires and replaces account approval ownership after admission fails", async () => {
    const { directory } = fixture();
    const events = directory.hubApproval.events as unknown as {
      subscribe: jest.Mock;
      unsubscribe: jest.Mock;
    };
    const failure = new Error("account approval watch unavailable");
    events.subscribe.mockRejectedValueOnce(failure);

    await expect(directory.init()).rejects.toBe(failure);
    expect(directory.hubApproval).toMatchObject({
      approvalStatus: "failed",
      approvalError: failure.message,
    });

    await directory.retryFailedApprovalOwners();

    expect(events.unsubscribe).toHaveBeenCalledTimes(1);
    expect(events.subscribe).toHaveBeenCalledTimes(2);
    expect(events.unsubscribe.mock.invocationCallOrder[0]).toBeLessThan(
      events.subscribe.mock.invocationCallOrder[1]!,
    );
    expect(directory.hubApproval).toMatchObject({
      approvalStatus: "ready",
      approvalError: null,
      approvals: [],
    });
    await directory.dispose();
  });

  it("keeps the System app source separate from lazily opened workspace clients", async () => {
    const { directory, account } = fixture();
    await directory.init();
    expect(account.openWorkspace.mock.calls.map(([id]) => id)).toEqual([
      "system",
      "personal",
    ]);
    const system = directory.sessions.get("system")!;
    const personal = directory.sessions.get("personal")!;
    expect(
      mockClients.find(({ config }) => config["workspaceId"] === "personal")
        ?.config["appSourceClient"],
    ).toBe(system.client);
    expect(personal.store.get(shellClientAtom)).toBe(personal.client);
    expect(directory.presented.has("system")).toBe(false);
    await directory.toggleExpanded("project");
    expect(directory.sessions.get("project")?.state).toBe("ready");
    expect(directory.activeWorkspaceId).toBe("personal");
    expect(directory.presented.has("project")).toBe(false);
    await directory.dispose();
  });

  it("keeps a workspace opening until approval admission and its first authoritative read complete", async () => {
    const { directory } = fixture();
    await directory.init();
    let admit!: () => void;
    const opening = directory.open("project");
    const project = directory.sessions.get("project")!;
    const client = project.client;
    let finishRead!: (
      pending: Awaited<ReturnType<typeof client.shellApproval.listPending>>,
    ) => void;
    jest.mocked(client.events.subscribe).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          admit = resolve;
        }),
    );
    jest.mocked(client.shellApproval.listPending).mockImplementationOnce(
      () =>
        new Promise<
          Awaited<ReturnType<typeof client.shellApproval.listPending>>
        >((resolve) => {
          finishRead = resolve;
        }),
    );

    for (let attempt = 0; attempt < 20 && !admit; attempt += 1)
      await Promise.resolve();
    expect(admit).toBeDefined();
    expect(project).toMatchObject({
      state: "opening",
      approvalStatus: "starting",
      approvals: null,
    });
    expect(finishRead).toBeUndefined();
    admit();
    for (let attempt = 0; attempt < 20 && !finishRead; attempt += 1)
      await Promise.resolve();
    expect(finishRead).toBeDefined();
    expect(project).toMatchObject({
      state: "opening",
      approvalStatus: "starting",
      approvals: null,
    });
    finishRead([]);

    await expect(opening).resolves.toBe(project);
    expect(project).toMatchObject({
      state: "ready",
      approvalStatus: "ready",
      approvals: [],
    });
    await directory.dispose();
  });

  it("fails workspace opening with the original approval readiness error", async () => {
    const { directory } = fixture();
    await directory.init();
    const failure = new Error("project approval queue unavailable");
    const opening = directory.open("project");
    const project = directory.sessions.get("project")!;
    jest
      .mocked(project.client.shellApproval.listPending)
      .mockRejectedValueOnce(failure);

    await expect(opening).rejects.toBe(failure);
    expect(project).toMatchObject({
      state: "failed",
      error: failure.message,
      approvalStatus: "failed",
      approvalError: failure.message,
    });
    expect(project.client.close).toHaveBeenCalled();

    await directory.retryFailedApprovalOwners();

    expect(directory.sessions.get("project")).not.toBe(project);
    expect(directory.sessions.get("project")).toMatchObject({
      state: "ready",
      approvalStatus: "ready",
      approvalError: null,
    });
    await directory.dispose();
  });

  it("joins approval admission before directory disposal completes", async () => {
    const { directory } = fixture();
    await directory.init();
    let admit!: () => void;
    const opening = directory.open("project");
    const project = directory.sessions.get("project")!;
    jest.mocked(project.client.events.subscribe).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          admit = resolve;
        }),
    );
    for (let attempt = 0; attempt < 20 && !admit; attempt += 1)
      await Promise.resolve();
    expect(admit).toBeDefined();

    const disposing = directory.dispose();
    let disposed = false;
    void disposing.then(() => {
      disposed = true;
    });
    await Promise.resolve();
    expect(disposed).toBe(false);
    expect(project.client.events.unsubscribe).not.toHaveBeenCalled();

    admit();
    await expect(opening).rejects.toThrow("controller is stopped");
    await disposing;
    expect(project.client.events.unsubscribe).toHaveBeenCalled();
    expect(project.client.close).toHaveBeenCalled();
  });

  it("keeps recovery incomplete until the authoritative approval refresh settles", async () => {
    const { directory } = fixture();
    await directory.init();
    const personal = directory.sessions.get("personal")!;
    let finishRead!: (
      pending: Awaited<
        ReturnType<typeof personal.client.shellApproval.listPending>
      >,
    ) => void;
    jest
      .mocked(personal.client.shellApproval.listPending)
      .mockImplementationOnce(
        () =>
          new Promise<
            Awaited<
              ReturnType<typeof personal.client.shellApproval.listPending>
            >
          >((resolve) => {
            finishRead = resolve;
          }),
      );

    const recovering = mockRecoveryHandlers.get("personal")!.resubscribe!();
    let recovered = false;
    void recovering.then(() => {
      recovered = true;
    });
    for (let attempt = 0; attempt < 20 && !finishRead; attempt += 1)
      await Promise.resolve();
    expect(finishRead).toBeDefined();
    expect(recovered).toBe(false);

    finishRead([]);
    await recovering;
    expect(recovered).toBe(true);
    await directory.dispose();
  });

  it("joins approval replacement before recovery refreshes the new controller", async () => {
    const { directory } = fixture();
    await directory.init();
    const personal = directory.sessions.get("personal")!;
    const staleRead = new Error("approval read failed");
    jest
      .mocked(personal.client.shellApproval.listPending)
      .mockRejectedValueOnce(staleRead);
    await expect(personal.approvalState!.refresh("manual")).rejects.toBe(
      staleRead,
    );

    let finishRetirement!: () => void;
    jest.mocked(personal.client.events.unsubscribe).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishRetirement = resolve;
        }),
    );
    type ApprovalRead = Awaited<
      ReturnType<typeof personal.client.shellApproval.listPending>
    >;
    let finishRecoveryRead!: (pending: ApprovalRead) => void;
    jest
      .mocked(personal.client.shellApproval.listPending)
      .mockClear()
      .mockResolvedValueOnce([])
      .mockImplementationOnce(
        () =>
          new Promise<ApprovalRead>((resolve) => {
            finishRecoveryRead = resolve;
          }),
      );

    const replacing = directory.retryFailedApprovalOwners();
    for (let attempt = 0; attempt < 20 && !finishRetirement; attempt += 1)
      await Promise.resolve();
    expect(personal.client.events.unsubscribe).toHaveBeenCalledTimes(1);
    const recovering = mockRecoveryHandlers.get("personal")!.resubscribe!();
    let recovered = false;
    void recovering.then(() => {
      recovered = true;
    });
    await Promise.resolve();
    expect(personal.client.shellApproval.listPending).not.toHaveBeenCalled();
    expect(recovered).toBe(false);

    finishRetirement();
    await replacing;
    for (let attempt = 0; attempt < 20 && !finishRecoveryRead; attempt += 1)
      await Promise.resolve();
    expect(finishRecoveryRead).toBeDefined();
    expect(personal.client.shellApproval.listPending).toHaveBeenCalledTimes(2);
    expect(recovered).toBe(false);

    finishRecoveryRead([]);
    await recovering;
    expect(recovered).toBe(true);
    await directory.dispose();
  });

  it("propagates approval replacement failure through concurrent recovery", async () => {
    const { directory } = fixture();
    await directory.init();
    const personal = directory.sessions.get("personal")!;
    const staleRead = new Error("approval read failed");
    jest
      .mocked(personal.client.shellApproval.listPending)
      .mockRejectedValueOnce(staleRead);
    await expect(personal.approvalState!.refresh("manual")).rejects.toBe(
      staleRead,
    );

    let finishRetirement!: () => void;
    jest.mocked(personal.client.events.unsubscribe).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishRetirement = resolve;
        }),
    );
    const replacementFailure = new Error("replacement admission failed");
    jest
      .mocked(personal.client.events.subscribe)
      .mockRejectedValueOnce(replacementFailure);

    const replacing = directory.retryFailedApprovalOwners();
    for (let attempt = 0; attempt < 20 && !finishRetirement; attempt += 1)
      await Promise.resolve();
    expect(personal.client.events.unsubscribe).toHaveBeenCalledTimes(1);
    const recovering = mockRecoveryHandlers.get("personal")!.resubscribe!();
    const replacementCheck = expect(replacing).rejects.toBe(replacementFailure);
    const recoveryCheck = expect(recovering).rejects.toBe(replacementFailure);
    finishRetirement();

    await Promise.all([replacementCheck, recoveryCheck]);
    await directory.dispose();
  });

  it("preserves separate panel focus for identical slot ids across workspace switches", async () => {
    const { directory } = fixture();
    await directory.init();
    const personal = directory.sessions.get("personal")!;
    personal.store.set(activePanelIdAtom, "personal-panel");
    await directory.activate("project", "project-panel");
    const project = directory.sessions.get("project")!;
    project.store.set(activePanelIdAtom, "project-panel");
    await directory.activate("personal");
    expect(directory.sessions.get("personal")).toBe(personal);
    expect(personal.store.get(activePanelIdAtom)).toBe("personal-panel");
    expect(project.store.get(activePanelIdAtom)).toBe("project-panel");
    expect(project.client.panels.focus).toHaveBeenCalledWith("project-panel");
    expect(personal.client.panels.focus).not.toHaveBeenCalledWith(
      "project-panel",
    );
    await directory.dispose();
  });

  it("does not let a slow opening reclaim focus or mutate another workspace client", async () => {
    const { directory } = fixture();
    await directory.init();
    let finish!: () => void;
    mockOpening.set(
      "project",
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const opening = directory.activate("project");
    const second = directory.open("project");
    await directory.activate("personal");
    finish();
    await opening;
    await second;
    expect(directory.activeWorkspaceId).toBe("personal");
    expect(
      mockClients.filter(({ config }) => config["workspaceId"] === "project"),
    ).toHaveLength(1);
    await directory.dispose();
  });

  it("keeps the latest panel choice while the same workspace is opening", async () => {
    const { directory } = fixture();
    await directory.init();
    let finish!: () => void;
    mockOpening.set(
      "project",
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    const first = directory.activate("project", "older-panel");
    const second = directory.activate("project", "newer-panel");
    finish();
    await Promise.all([first, second]);
    const session = directory.sessions.get("project")!;
    expect(session.client.panels.focus).toHaveBeenCalledTimes(1);
    expect(session.client.panels.focus).toHaveBeenCalledWith("newer-panel");
    await directory.dispose();
  });

  it("creates in the captured workspace without reclaiming focus after another gesture", async () => {
    const { directory } = fixture();
    await directory.init();
    const personal = directory.sessions.get("personal")!;
    let finish!: (value: { id: string; title: string }) => void;
    jest.mocked(personal.client.panels.createAboutPanel).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const creating = directory.createPanel("personal");
    await new Promise((resolve) => setTimeout(resolve, 0));
    await directory.activate("project");
    finish({ id: "captured-new-panel", title: "New panel" });
    await creating;
    expect(directory.activeWorkspaceId).toBe("project");
    expect(personal.client.panels.focus).toHaveBeenCalledWith(
      "captured-new-panel",
    );
    expect(
      directory.sessions.get("project")!.client.panels.createAboutPanel,
    ).not.toHaveBeenCalled();
    await directory.dispose();
  });

  it("rejects notification targets belonging to another user before opening their workspace", async () => {
    const { directory, account } = fixture();
    await directory.init();
    await expect(
      directory.resolveNotificationWorkspace({
        serverId: "srv_aaaaaaaaaaaaaaaaaaaaaaaa",
        userId: "bob",
        workspaceId: "project",
      }),
    ).rejects.toThrow("another account");
    expect(account.openWorkspace).toHaveBeenCalledTimes(2);
    await expect(
      directory.openApproval({
        serverId: "srv_aaaaaaaaaaaaaaaaaaaaaaaa",
        userId: "bob",
        workspaceId: "project",
        approvalId: "wrong-account-review",
      }),
    ).rejects.toThrow("another account");
    expect(directory.approvalWorkspaceId).toBeNull();
    expect(account.openWorkspace).toHaveBeenCalledTimes(2);
    await directory.dispose();
  });
});

it("opens a referenced source in its accessible owning workspace without moving a source panel", async () => {
  const { directory } = fixture();
  await directory.init();
  const personal = directory.sessions.get("personal")!;
  await directory.openPanelSource("project", "panels/chat", {
    ref: "feature",
    contextId: "target-context",
    stateArgs: { document: "notes" },
    focus: true,
  });
  const project = directory.sessions.get("project")!;
  expect(project.client.panels.createRootPanel).toHaveBeenCalledWith(
    "panels/chat",
    {
      ref: "feature",
      contextId: "target-context",
      stateArgs: { document: "notes" },
      focus: true,
    },
  );
  expect(personal.client.panels.createRootPanel).not.toHaveBeenCalled();
  expect(directory.activeWorkspaceId).toBe("project");
  await expect(
    directory.openPanelSource("unavailable", "about/new", {}),
  ).rejects.toThrow("access");
  expect(directory.activeWorkspaceId).toBe("project");
  await directory.dispose();
});

it("shows unopened workspace attention without opening sessions and removes revoked entries", async () => {
  const { directory, account } = fixture();
  await directory.init();
  account.control.rpc.call.mockResolvedValueOnce(
    entries.map((entry) => ({
      ...entry,
      pendingApprovalCount: entry.workspaceId === "project" ? 3 : 0,
    })),
  );
  await directory.refresh();
  expect(directory.pendingApprovalCounts.get("project")).toBe(3);
  expect(directory.approvalCount).toBe(3);
  expect(account.openWorkspace).toHaveBeenCalledTimes(2);
  directory.openApprovals("project");
  await directory.open("project");
  expect(directory.activeWorkspaceId).toBe("personal");
  expect(account.openWorkspace).toHaveBeenCalledWith(
    "project",
    expect.any(Function),
  );
  account.control.rpc.call.mockResolvedValueOnce(
    entries.filter((entry) => entry.workspaceId !== "project"),
  );
  await directory.refresh();
  expect(directory.pendingApprovalCounts.has("project")).toBe(false);
  await directory.dispose();
});

it("presents background approvals without switching workspace, preserves selection, and navigates colliding IDs safely", async () => {
  const { directory } = fixture();
  await directory.init();
  const system = directory.sessions.get("system")!;
  const personal = directory.sessions.get("personal")!;
  const request = {
    approvalId: "same-id",
    callerId: "worker-1",
    callerKind: "worker" as const,
    repoPath: "workers/example",
    effectiveVersion: "v1",
    requestedAt: 1,
    kind: "capability" as const,
    capability: "read",
    title: "Read document",
  };
  jest
    .mocked(system.client.shellApproval.listPending)
    .mockResolvedValue([request]);
  await system.approvalState!.refresh("manual");
  expect(directory.approvalWorkspaceId).toBe("system");
  expect(directory.activeWorkspaceId).toBe("personal");
  directory.closeApprovals();
  await system.approvalState!.refresh("manual");
  expect(directory.approvalWorkspaceId).toBeNull();
  jest
    .mocked(personal.client.shellApproval.listPending)
    .mockResolvedValue([request]);
  await personal.approvalState!.refresh("manual");
  expect(directory.approvalWorkspaceId).toBe("system");
  directory.stepApproval(-1);
  expect(directory.approvalWorkspaceId).toBe("personal");
  expect(directory.activeWorkspaceId).toBe("personal");
  jest.mocked(personal.client.shellApproval.listPending).mockResolvedValue([]);
  await personal.approvalState!.refresh("manual");
  expect(directory.approvalWorkspaceId).toBe("system");
  directory.closeApprovals();
  await expect(
    directory.selectApproval("system", "missing-review"),
  ).rejects.toThrow("no longer pending");
  expect(directory.approvalWorkspaceId).toBeNull();
  await directory.selectApproval("system", "same-id");
  expect(directory.approvalWorkspaceId).toBe("system");
  expect(directory.activeWorkspaceId).toBe("personal");
  await directory.dispose();
});

it("loads unopened pending owners into the global queue without presenting or focusing their panels", async () => {
  const { directory, account } = fixture();
  await directory.init();
  const request = {
    approvalId: "same-id",
    callerId: "worker-1",
    callerKind: "worker" as const,
    repoPath: "workers/example",
    effectiveVersion: "v1",
    requestedAt: 1,
    kind: "capability" as const,
    capability: "read",
    title: "Read document",
  };
  const personal = directory.sessions.get("personal")!;
  jest
    .mocked(personal.client.shellApproval.listPending)
    .mockResolvedValue([request]);
  await personal.approvalState!.refresh("manual");
  directory.updateApprovalCount("project", 1);
  let finish!: () => void;
  mockOpening.set(
    "project",
    new Promise<void>((resolve) => {
      finish = resolve;
    }),
  );
  directory.openApprovals();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(account.openWorkspace).toHaveBeenCalledWith(
    "project",
    expect.any(Function),
  );
  expect(directory.unloadedApprovalWorkspaces).toEqual([
    expect.objectContaining({ state: "loading" }),
  ]);
  expect(directory.activeWorkspaceId).toBe("personal");
  expect(directory.presented.has("project")).toBe(false);
  const project = directory.sessions.get("project")!;
  jest
    .mocked(project.client.shellApproval.listPending)
    .mockResolvedValue([request]);
  finish();
  await directory.open("project");
  await project.approvalState!.refresh("manual");
  expect(
    directory.approvalItems.map(({ owner }) =>
      owner.kind === "workspace" ? owner.workspaceId : "hub",
    ),
  ).toEqual(["personal", "project"]);
  expect(directory.approvalWorkspaceId).toBe("personal");
  directory.stepApproval(1);
  expect(directory.approvalWorkspaceId).toBe("project");
  expect(directory.activeWorkspaceId).toBe("personal");
  expect(directory.presented.has("project")).toBe(false);
  await directory.dispose();
});

it("does not reopen a dismissed shared queue when an earlier exact selection finishes refreshing", async () => {
  const { directory } = fixture();
  await directory.init();
  const system = directory.sessions.get("system")!;
  const request = {
    approvalId: "exact-review",
    callerId: "worker-1",
    callerKind: "worker" as const,
    repoPath: "workers/example",
    effectiveVersion: "v1",
    requestedAt: 1,
    kind: "capability" as const,
    capability: "read",
    title: "Read document",
  };
  jest
    .mocked(system.client.shellApproval.listPending)
    .mockResolvedValue([request]);
  await system.approvalState!.refresh("manual");
  let finish!: () => void;
  jest.spyOn(system.approvalState!, "refresh").mockImplementationOnce(
    () =>
      new Promise<PendingApproval[]>((resolve) => {
        finish = () => resolve([request]);
      }),
  );
  const selecting = directory.selectApproval("system", "exact-review");
  await new Promise((resolve) => setTimeout(resolve, 0));
  directory.closeApprovals();
  finish();
  await selecting;
  expect(directory.approvalWorkspaceId).toBeNull();
  expect(directory.activeWorkspaceId).toBe("personal");
  await directory.dispose();
});

it("opens Personal alongside System while retaining System's app-source owner", async () => {
  let resolveSystem!: () => void;
  mockOpening.set(
    "system",
    new Promise<void>((resolve) => {
      resolveSystem = resolve;
    }),
  );
  const { directory } = fixture();
  const starting = directory.init();
  try {
    // Advance promise continuations without releasing System's readiness gate.
    for (let i = 0; i < 30 && !directory.sessions.has("personal"); i++)
      await Promise.resolve();
    expect(directory.sessions.has("personal")).toBe(true);
    const personal = mockClients.find(
      ({ config }) => config["workspaceId"] === "personal",
    )!;
    expect(personal.config["appSourceClient"]).toBe(
      directory.sessions.get("system")!.client,
    );
    await starting;
    expect(directory.activeWorkspaceId).toBe("personal");
    expect(directory.sessions.get("personal")?.state).toBe("ready");
    expect(directory.sessions.get("system")?.state).toBe("opening");
    resolveSystem();
    await directory.open("system");
    expect(directory.sessions.get("system")?.state).toBe("ready");
  } finally {
    resolveSystem();
    await starting.catch(() => undefined);
    await directory.dispose();
  }
});

it("joins the retained System startup owner during directory disposal", async () => {
  let resolveSystem!: () => void;
  mockOpening.set(
    "system",
    new Promise<void>((resolve) => {
      resolveSystem = resolve;
    }),
  );
  const { directory } = fixture();
  await directory.init();
  const disposing = directory.dispose();
  let disposed = false;
  void disposing.then(() => {
    disposed = true;
  });

  await Promise.resolve();
  expect(disposed).toBe(false);
  resolveSystem();
  await disposing;
  expect(disposed).toBe(true);
});

it("surfaces a retained System startup failure without retracting Personal", async () => {
  let rejectSystem!: (error: Error) => void;
  mockOpening.set(
    "system",
    new Promise<void>((_resolve, reject) => {
      rejectSystem = reject;
    }),
  );
  const { directory } = fixture();
  await directory.init();
  rejectSystem(new Error("System workspace unavailable"));
  for (
    let attempts = 0;
    attempts < 20 && directory.sessions.get("system")?.state !== "failed";
    attempts += 1
  )
    await Promise.resolve();

  expect(directory.activeWorkspaceId).toBe("personal");
  expect(directory.sessions.get("personal")?.state).toBe("ready");
  expect(directory.sessions.get("system")).toMatchObject({
    state: "failed",
    error: "System workspace unavailable",
  });
  await directory.dispose();
});
