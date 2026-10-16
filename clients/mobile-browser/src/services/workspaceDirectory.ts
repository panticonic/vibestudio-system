import { createTypedRpcServiceClient } from "@vibestudio/shared/typedRpcServiceClient";
import {
  submitWorkspaceCreation,
  readWorkspaceCreationSubmission,
} from "@vibestudio/service-schemas/clients/workspaceCreationClient";
import type { WorkspaceCreationReceipt } from "@vibestudio/workspace-contracts/types";
import { clearWorkspaceCookies } from "./workspaceBrowserProfile";
import {
  resolvePanelWorkspace,
  type PanelLocation,
} from "@vibestudio/shared/panelLocation";
import { extensionsMethods } from "@vibestudio/service-schemas/extensions";
import { workspaceName as displayWorkspaceName } from "./workspaceName";
import {
  templatesMethods,
  type TemplateExactPin,
} from "@vibestudio/service-schemas/templates";
import {
  createApprovalStateController,
  SHELL_APPROVAL_PENDING_CHANGED_EVENT,
  type ApprovalStateController,
} from "@vibestudio/shell-core/approvalState";
import { actionableRuntimeApprovals } from "@vibestudio/shared/approvalVisibility";
import type { PendingApproval } from "@vibestudio/shared/approvals";
import {
  type WorkspacePushScope,
  type WorkspaceApprovalTarget,
} from "@vibestudio/shared/workspacePushScope";
import {
  approvalPresentationKey,
  createApprovalPresentationState,
  reconcileApprovalPresentation,
  selectApprovalPresentation,
  stepApprovalPresentation,
} from "@vibestudio/shared/approvalPresentation";
import { createStore } from "jotai";
import type { HubWorkspaceEntry as MobileHubWorkspace } from "@vibestudio/service-schemas/hubControl";
import type { RemoteAccount, RnClientApi } from "@vibestudio/rn-client-api";
import { MobileConnectionAggregateError } from "./mobileTransport";
import { hubControlMethods } from "@vibestudio/service-schemas/hubControl";
import { createTypedServiceClient } from "@vibestudio/shared/typedServiceClient";
import { shellApprovalMethods } from "@vibestudio/service-schemas/shellApproval";
import { EventsClient } from "@vibestudio/service-schemas/clients/eventsClient";
import type { RpcDestination } from "@vibestudio/rpc";
import { ShellClient } from "./shellClient";
import {
  shellClientAtom,
  panelTreeRevisionAtom,
} from "../state/shellClientAtom";
import {
  connectionStatusAtom,
  workspaceReadinessAtom,
} from "../state/connectionAtoms";
import { serverUrlAtom } from "../state/authAtoms";
import { getNativeAppStorage } from "./nativeAppStorage";
import type { EventPayloads } from "@vibestudio/shared/events";
import { serializeByKey } from "@vibestudio/shared/keyedSerializer";

export interface MobileWorkspaceSession {
  readonly workspaceId: string;
  readonly client: ShellClient;
  readonly store: ReturnType<typeof createStore>;
  state: "opening" | "ready" | "failed";
  error: string | null;
  approvals: PendingApproval[] | null;
  approvalStatus: "starting" | "ready" | "failed";
  approvalState: ApprovalStateController | null;
  approvalError: string | null;
  stopApprovalRecovery?: () => void;
}

export interface MobileApprovalOwner {
  readonly owner: RpcDestination;
  readonly label: string;
  readonly shellApproval: MobileWorkspaceSession["client"]["shellApproval"];
  readonly events: EventsClient;
  readonly session?: MobileWorkspaceSession;
  approvals: PendingApproval[] | null;
  approvalStatus: "starting" | "ready" | "failed";
  approvalState: ApprovalStateController | null;
  approvalError: string | null;
  approvalAdmissionError?: unknown;
}

/** Account-owned directory. A workspace's client and UI store are never rebound. */
export class MobileWorkspaceDirectory {
  readonly sessions = new Map<string, MobileWorkspaceSession>();
  readonly workspaceApprovalOwners = new Map<string, MobileApprovalOwner>();
  readonly expanded = new Set<string>();
  readonly presented = new Set<string>();
  readonly hubControl;
  readonly hubApproval: MobileApprovalOwner;
  entries: MobileHubWorkspace[] = [];
  activeWorkspaceId: string | null = null;
  personalWorkspaceId = "";
  systemWorkspaceId = "";
  error: string | null = null;
  workspaceCreation: {
    template?: TemplateExactPin;
    sourceUrl?: string;
  } | null = null;
  /** Account metadata for unopened workspaces; live controllers refine connected queues. */
  readonly pendingApprovalCounts = new Map<string, number>();
  approvalPresentation = createApprovalPresentationState();
  private requestedApproval: {
    workspaceId: string;
    approvalId?: string;
    phase?: "loading";
  } | null = null;

  get approvalItems() {
    const workspaceItems = this.entries.flatMap((entry) =>
      (this.sessions.get(entry.workspaceId)?.approvals ?? []).map(
        (approval) => ({
          owner: { kind: "workspace" as const, workspaceId: entry.workspaceId },
          workspaceId: entry.workspaceId,
          approvalId: approval.approvalId,
          actionable: approval.lifecycle?.state !== "preparing",
          approval,
        }),
      ),
    );
    return [
      ...(this.hubApproval.approvals ?? []).map((approval) => ({
        owner: this.hubApproval.owner,
        approvalId: approval.approvalId,
        actionable: approval.lifecycle?.state !== "preparing",
        approval,
      })),
      ...workspaceItems,
    ];
  }

  get selectedApproval() {
    return this.approvalItems.find(
      (item) =>
        approvalPresentationKey(item) === this.approvalPresentation.selectedKey,
    );
  }

  get approvalWorkspaceId(): string | null {
    return (
      (this.requestedApproval?.phase === "loading"
        ? null
        : this.requestedApproval?.workspaceId) ??
      (this.approvalPresentation.open
        ? this.selectedApproval?.owner.kind === "workspace"
          ? this.selectedApproval.owner.workspaceId
          : null
        : null)
    );
  }

  get selectedApprovalOwner(): MobileApprovalOwner | null {
    const selected = this.selectedApproval;
    if (!selected) return null;
    if (selected.owner.kind === "hub") return this.hubApproval;
    return this.workspaceApprovalOwners.get(selected.owner.workspaceId) ?? null;
  }

  get approvalOwnerErrors(): string[] {
    return [
      ...(this.hubApproval.approvalError
        ? [`Account: ${this.hubApproval.approvalError}`]
        : []),
      ...[...this.sessions.values()].flatMap((session) =>
        session.approvalError
          ? [`${session.client.workspaceName}: ${session.approvalError}`]
          : [],
      ),
    ];
  }

  get failedApprovalOwners(): readonly MobileApprovalOwner[] {
    return [
      ...(this.hubApproval.approvalError ? [this.hubApproval] : []),
      ...[...this.workspaceApprovalOwners.values()].filter(
        (owner) => owner.approvalError,
      ),
    ];
  }

  async retryFailedApprovalOwners(): Promise<void> {
    if (this.disposed) throw new Error("The mobile account is closed");
    const failed = this.failedApprovalOwners;
    await Promise.all(
      failed.map(async (owner) => {
        const key =
          owner.owner.kind === "workspace"
            ? `workspace:${owner.owner.workspaceId}`
            : "hub";
        let operation!: Promise<void>;
        operation = serializeByKey(this.approvalReplacements, key, async () => {
          const session = owner.session;
          if (session?.state === "failed") {
            await this.open(session.workspaceId);
            return;
          }
          await this.retireApprovalState(owner);
          if (!this.disposed) await this.startApprovalState(owner);
        });
        this.approvalReplacementReceipts.set(key, operation);
        try {
          await operation;
        } finally {
          if (this.approvalReplacementReceipts.get(key) === operation)
            this.approvalReplacementReceipts.delete(key);
        }
      }),
    );
  }

  stepApproval(delta: number): void {
    this.requestedApproval = null;
    this.approvalPresentation = stepApprovalPresentation(
      this.approvalPresentation,
      this.approvalItems,
      delta,
    );
    this.changed();
  }

  private reconcileApprovals(): void {
    const wasOpen =
      this.approvalPresentation.open || this.requestedApproval !== null;
    const items = this.approvalItems;
    this.approvalPresentation = reconcileApprovalPresentation(
      this.approvalPresentation,
      items,
    );
    const requested = this.requestedApproval;
    if (requested?.phase === "loading") return;
    if (requested) {
      const item = items.find(
        (item) =>
          item.owner.kind === "workspace" &&
          item.owner.workspaceId === requested.workspaceId &&
          (!requested.approvalId || item.approvalId === requested.approvalId),
      );
      if (item) {
        this.approvalPresentation = selectApprovalPresentation(
          this.approvalPresentation,
          items,
          approvalPresentationKey(item),
        );
        this.requestedApproval = null;
      } else if (
        this.sessions.get(requested.workspaceId)?.approvalStatus === "ready" &&
        this.sessions.get(requested.workspaceId)?.state === "ready"
      ) {
        this.requestedApproval = null;
      }
    }
    if (!this.requestedApproval && wasOpen && !items.length) {
      const loading = this.unloadedApprovalWorkspaces.find(
        ({ state }) => state !== "unopened",
      );
      if (loading)
        this.requestedApproval = { workspaceId: loading.entry.workspaceId };
    }
  }
  private revision = 0;
  private selectionGeneration = 0;
  private readonly listeners = new Set<() => void>();
  private readonly opening = new Map<string, Promise<MobileWorkspaceSession>>();
  private readonly startupOperations = new Set<Promise<void>>();
  private readonly approvalRetirements = new Set<Promise<void>>();
  private readonly approvalReplacements = new Map<string, Promise<unknown>>();
  private readonly approvalReplacementReceipts = new Map<
    string,
    Promise<void>
  >();
  private stopWorkspaceCatalog: (() => void) | null = null;
  private workspaceCatalogGeneration = 0;
  private disposed = false;
  private closing: Promise<void> | null = null;

  /** The account server's Endpoint ID the host authenticated (lower-case). */
  readonly serverEndpointId: string;
  /** This device's identity on that server. */
  readonly deviceId: string;

  constructor(readonly account: RemoteAccount) {
    const { serverId, deviceId } = account.control;
    if (!serverId || !deviceId) {
      throw new Error(
        "The account connection did not report its server and device identity",
      );
    }
    this.serverEndpointId = serverId.toLowerCase();
    this.deviceId = deviceId;
    this.hubControl = createTypedRpcServiceClient(
      account.control.rpc,
      { targetId: "main", namespace: "hubControl" },
      hubControlMethods,
    );
    const shellApproval = createTypedRpcServiceClient(
      account.control.rpc,
      { targetId: "main", namespace: "shellApproval" },
      shellApprovalMethods,
    );
    this.hubApproval = {
      owner: { kind: "hub" },
      label: "Account",
      shellApproval,
      events: new EventsClient(account.control.rpc),
      approvals: null,
      approvalStatus: "starting",
      approvalState: null,
      approvalError: null,
    };
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getSnapshot = (): number => this.revision;
  private changed(): void {
    this.reconcileApprovals();
    this.revision += 1;
    for (const listener of this.listeners) listener();
  }

  async init(): Promise<void> {
    const [pair, saved] = await Promise.all([
      this.hubControl.ensureUserWorkspaces(),
      getNativeAppStorage().getItem(this.selectionKey),
      this.startHubApprovalState(),
    ]);
    this.personalWorkspaceId = pair.personal.workspaceId;
    this.systemWorkspaceId = pair.system.workspaceId;
    this.stopWorkspaceCatalog = this.hubApproval.events.on(
      "hub:workspace-catalog-changed",
      (payload) => {
        this.workspaceCatalogGeneration += 1;
        this.applyWorkspaceEntries(payload.workspaces);
      },
    );
    await this.hubApproval.events.subscribe("hub:workspace-catalog-changed");
    await this.refresh();
    // System owns the device surfaces the server calls into (readiness,
    // browser privacy, browser import); it opens alongside the selection.
    const system = this.open(this.systemWorkspaceId);
    const selected = this.entries.some((entry) => entry.workspaceId === saved)
      ? saved!
      : this.personalWorkspaceId;
    this.ownSystemStartup(
      system.then(async (session) => {
        await session.client.refreshAccountProfile();
      }),
    );
    // The selected workspace owns first presentation. System's independent
    // initialization and profile read cannot withhold an already restored
    // selected workspace.
    await this.activate(selected);
  }

  private ownSystemStartup(operation: Promise<void>): void {
    let owned!: Promise<void>;
    owned = operation
      .catch((error: unknown) => {
        if (this.disposed) return;
        const session = this.sessions.get(this.systemWorkspaceId);
        if (session && session.state !== "failed") {
          session.state = "failed";
          session.error =
            error instanceof Error ? error.message : String(error);
          session.client.dispose();
          this.changed();
        }
      })
      .finally(() => this.startupOperations.delete(owned));
    this.startupOperations.add(owned);
  }

  private ownApprovalRetirement(operation: Promise<void>): void {
    this.approvalRetirements.add(operation);
    void operation.then(
      () => this.approvalRetirements.delete(operation),
      (error: unknown) => {
        this.approvalRetirements.delete(operation);
        if (this.disposed) return;
        this.error = error instanceof Error ? error.message : String(error);
        this.changed();
      },
    );
  }

  private createApprovalState(
    owner: MobileApprovalOwner,
  ): ApprovalStateController {
    const session = owner.session;
    owner.approvalStatus = "starting";
    owner.approvalError = null;
    owner.approvalAdmissionError = undefined;
    if (session) {
      session.approvalStatus = "starting";
      session.approvalError = null;
    }
    let controller!: ApprovalStateController;
    controller = createApprovalStateController({
      listPending: () => owner.shellApproval.listPending(),
      subscribePendingChanged: () =>
        owner.events.subscribe(SHELL_APPROVAL_PENDING_CHANGED_EVENT),
      unsubscribePendingChanged: () =>
        owner.events.unsubscribe(SHELL_APPROVAL_PENDING_CHANGED_EVENT),
      onPendingChanged: (listener) =>
        owner.events.on(SHELL_APPROVAL_PENDING_CHANGED_EVENT, listener),
      onChange: (pending) => {
        if (this.disposed || owner.approvalState !== controller) return;
        owner.approvals = pending;
        owner.approvalStatus = "ready";
        owner.approvalError = null;
        if (session) {
          session.approvals = pending;
          session.approvalStatus = "ready";
          session.approvalError = null;
          this.updateApprovalCount(
            session.workspaceId,
            actionableRuntimeApprovals(pending).length,
          );
        }
        this.changed();
      },
      onError: (error, phase) => {
        if (this.disposed || owner.approvalState !== controller) return;
        if (phase === "subscribe") owner.approvalAdmissionError = error;
        owner.approvalError =
          error instanceof Error ? error.message : String(error);
        owner.approvalStatus = "failed";
        if (session) {
          session.approvalError = owner.approvalError;
          session.approvalStatus = "failed";
        }
        console.warn(
          session
            ? `[WorkspaceDirectory] Approval ${phase} failed in ${session.workspaceId}`
            : `[WorkspaceDirectory] Account approval ${phase} failed`,
          error,
        );
        this.changed();
      },
    });
    owner.approvalState = controller;
    if (session) session.approvalState = controller;
    return controller;
  }

  private async startApprovalState(owner: MobileApprovalOwner): Promise<void> {
    await this.createApprovalState(owner).start();
  }

  private async retireApprovalState(owner: MobileApprovalOwner): Promise<void> {
    const controller = owner.approvalState;
    if (!controller) return;
    try {
      await controller.stop();
    } catch (error) {
      // A failed start is already presented. The same rejection after stop
      // means its unsubscribe completed; a different failure is retirement.
      if (error !== owner.approvalAdmissionError) throw error;
    } finally {
      if (owner.approvalState === controller) owner.approvalState = null;
      if (owner.session?.approvalState === controller)
        owner.session.approvalState = null;
    }
  }

  private async retireWorkspaceOwner(
    owner: MobileApprovalOwner,
    client: ShellClient,
  ): Promise<void> {
    const failures: unknown[] = [];
    try {
      await this.retireApprovalState(owner);
    } catch (error) {
      failures.push(error);
    }
    try {
      await client.close();
    } catch (error) {
      failures.push(error);
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1)
      throw new AggregateError(
        failures,
        "Approval observation and workspace connection retirement failed",
        { cause: failures[0] },
      );
  }

  private async startHubApprovalState(): Promise<void> {
    await this.startApprovalState(this.hubApproval);
  }

  private get selectionKey(): string {
    return `vibestudio:active-workspace:${this.serverEndpointId}:${this.deviceId}`;
  }

  async refresh(): Promise<void> {
    for (;;) {
      const observed = this.workspaceCatalogGeneration;
      try {
        const entries = await this.hubControl.listWorkspaces();
        if (this.disposed) return;
        if (observed !== this.workspaceCatalogGeneration) continue;
        this.applyWorkspaceEntries(entries);
        return;
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error);
        this.changed();
        throw error;
      }
    }
  }

  private applyWorkspaceEntries(
    incoming: EventPayloads["hub:workspace-catalog-changed"]["workspaces"],
  ): void {
    const entries = [...incoming];
    this.entries = entries.sort((a, b) => {
      const rank = (entry: MobileHubWorkspace) =>
        entry.workspaceId === this.personalWorkspaceId
          ? 0
          : entry.workspaceId === this.systemWorkspaceId
            ? 2
            : 1;
      return rank(a) - rank(b) || a.name.localeCompare(b.name);
    });
    const accessible = new Set(entries.map((entry) => entry.workspaceId));
    for (const id of this.pendingApprovalCounts.keys()) {
      if (!accessible.has(id)) {
        this.pendingApprovalCounts.delete(id);
        if (this.requestedApproval?.workspaceId === id)
          this.requestedApproval = null;
      }
    }
    for (const entry of entries) {
      const session = this.sessions.get(entry.workspaceId);
      if (session?.approvalStatus !== "ready" || session.state !== "ready") {
        this.pendingApprovalCounts.set(
          entry.workspaceId,
          entry.pendingApprovalCount,
        );
      }
    }
    for (const [id, session] of this.sessions) {
      if (!entries.some((entry) => entry.workspaceId === id)) {
        session.stopApprovalRecovery?.();
        const approvalOwner = this.workspaceApprovalOwners.get(id);
        this.ownApprovalRetirement(
          approvalOwner
            ? this.retireWorkspaceOwner(approvalOwner, session.client)
            : session.client.close(),
        );
        this.sessions.delete(id);
        this.workspaceApprovalOwners.delete(id);
        this.expanded.delete(id);
        this.presented.delete(id);
        this.pendingApprovalCounts.delete(id);
        if (this.requestedApproval?.workspaceId === id)
          this.requestedApproval = null;
      }
    }
    this.error = null;
    this.changed();
  }

  /** Report the visible workspace, not merely a paired credential or System connection. */
  phoneSetupReadiness(): {
    status: "opening" | "ready" | "failed";
    message: string;
  } {
    const session = this.activeWorkspaceId
      ? this.sessions.get(this.activeWorkspaceId)
      : undefined;
    if (!session)
      return {
        status: "opening",
        message: "Opening your workspace on the phone…",
      };
    const readiness = session.store.get(workspaceReadinessAtom);
    if (session.state === "failed" || readiness === "failed") {
      return {
        status: "failed",
        message:
          session.error ??
          "The phone could not prepare the workspace. Check the message on your phone.",
      };
    }
    if (
      session.state === "ready" &&
      session.store.get(connectionStatusAtom) === "connected" &&
      readiness === "reconciled"
    ) {
      return {
        status: "ready",
        message:
          "Your workspace is ready on the phone. You can unplug the USB cable.",
      };
    }
    return {
      status: "opening",
      message:
        "Preparing your workspace. Keep the phone open and respond to any approval shown there.",
    };
  }

  open(workspaceId: string): Promise<MobileWorkspaceSession> {
    if (this.disposed)
      return Promise.reject(new Error("The mobile account is closed"));
    const pending = this.opening.get(workspaceId);
    if (pending) return pending;
    const existing = this.sessions.get(workspaceId);
    if (existing?.state === "ready") return Promise.resolve(existing);
    const entry = this.entries.find((item) => item.workspaceId === workspaceId);
    if (!entry)
      return Promise.reject(
        new Error("You no longer have access to this workspace"),
      );
    existing?.stopApprovalRecovery?.();
    const existingApprovalOwner = this.workspaceApprovalOwners.get(workspaceId);
    const retireExisting = existing
      ? existingApprovalOwner
        ? this.retireWorkspaceOwner(existingApprovalOwner, existing.client)
        : existing.client.close()
      : Promise.resolve();
    const store = createStore();
    const client = new ShellClient({
      credentials: { deviceId: this.deviceId },
      serverEndpointId: this.serverEndpointId,
      workspaceId,
      workspaceName: displayWorkspaceName(entry),
      connectWorkspace: (onRecovery) =>
        this.account.openWorkspace(workspaceId, onRecovery),
      exposesDeviceSurfaces: workspaceId === this.systemWorkspaceId,
      getWorkspaceReadiness: () => this.phoneSetupReadiness(),
      onStatusChange: (status) => {
        store.set(connectionStatusAtom, status);
        this.changed();
      },
      onReadinessChange: (readiness) => {
        store.set(workspaceReadinessAtom, readiness);
      },
      onTreeInvalidated: (event) =>
        store.set(panelTreeRevisionAtom, event.revision),
      onPanelsChanged: () =>
        store.set(panelTreeRevisionAtom, (revision) => revision + 1),
    });
    store.set(shellClientAtom, client);
    const session: MobileWorkspaceSession = {
      workspaceId,
      client,
      store,
      state: "opening",
      error: null,
      approvals: null,
      approvalStatus: "starting",
      approvalState: null,
      approvalError: null,
    };
    const approvalOwner: MobileApprovalOwner = {
      owner: { kind: "workspace", workspaceId },
      label: client.workspaceName,
      shellApproval: client.shellApproval,
      events: client.events,
      session,
      approvals: null,
      approvalStatus: "starting",
      approvalState: null,
      approvalError: null,
    };
    this.sessions.set(workspaceId, session);
    this.workspaceApprovalOwners.set(workspaceId, approvalOwner);
    this.changed();
    const opening = retireExisting
      .then(() => client.init())
      .then(async () => {
        if (this.disposed || this.sessions.get(workspaceId) !== session) {
          throw new Error("The workspace was closed while opening");
        }
        store.set(serverUrlAtom, client.serverUrl);
        await this.startApprovalState(approvalOwner);
        if (this.disposed || this.sessions.get(workspaceId) !== session) {
          await this.retireApprovalState(approvalOwner);
          await client.close();
          throw new Error("The workspace was closed while opening");
        }
        session.state = "ready";
        const recoverApprovals = async () => {
          const key = `workspace:${workspaceId}`;
          const replacement = this.approvalReplacementReceipts.get(key);
          await serializeByKey(this.approvalReplacements, key, async () => {
            if (replacement) await replacement;
            const controller = session.approvalState;
            if (!controller)
              throw new Error(
                `Approval observation is unavailable for ${workspaceId}`,
              );
            await controller.refresh("manual");
          });
        };
        const stopResubscribe = client.recovery.registerResubscribeHandler(
          `mobile-approval-state:${workspaceId}`,
          recoverApprovals,
          { includeCurrentGeneration: false },
        );
        const stopColdRecover = client.recovery.registerColdRecoverHandler(
          `mobile-approval-state:${workspaceId}`,
          recoverApprovals,
        );
        session.stopApprovalRecovery = () => {
          stopResubscribe();
          stopColdRecover();
        };
        this.changed();
        return session;
      })
      .catch(async (error: unknown) => {
        session.state = "failed";
        session.error = error instanceof Error ? error.message : String(error);
        const cleanup = await Promise.allSettled([
          this.retireWorkspaceOwner(approvalOwner, client),
        ]);
        this.changed();
        const cleanupFailures = cleanup.flatMap((result) =>
          result.status === "rejected" ? [result.reason] : [],
        );
        if (cleanupFailures.length)
          throw new AggregateError(
            [error, ...cleanupFailures],
            "Workspace approval startup and cleanup failed",
            { cause: error },
          );
        throw error;
      })
      .finally(() => this.opening.delete(workspaceId));
    this.opening.set(workspaceId, opening);
    return opening;
  }

  async activate(workspaceId: string, panelId?: string): Promise<void> {
    if (!this.entries.some((entry) => entry.workspaceId === workspaceId)) {
      throw new Error("You do not have access to this workspace");
    }
    const selectionGeneration = ++this.selectionGeneration;
    this.activeWorkspaceId = workspaceId;
    this.presented.add(workspaceId);
    this.expanded.add(workspaceId);
    this.changed();
    const session = await this.open(workspaceId);
    if (selectionGeneration !== this.selectionGeneration) return;
    if (panelId) await session.client.panels.focus(panelId);
    // A slower workspace opening cannot take focus back from a later gesture.
    if (selectionGeneration !== this.selectionGeneration) return;
    await getNativeAppStorage().setItem(this.selectionKey, workspaceId);
    this.changed();
  }

  async toggleExpanded(workspaceId: string): Promise<void> {
    if (this.expanded.delete(workspaceId)) {
      this.changed();
      return;
    }
    this.expanded.add(workspaceId);
    this.changed();
    await this.open(workspaceId);
  }

  requestWorkspaceCreation(
    source: { template?: TemplateExactPin; sourceUrl?: string } = {},
  ): void {
    this.workspaceCreation = source;
    this.changed();
  }

  closeWorkspaceCreation(): void {
    this.workspaceCreation = null;
    this.changed();
  }

  async inspectWorkspaceTemplate(
    locator: import("@vibestudio/service-schemas/templates").TemplateLocator,
  ) {
    const system = await this.open(this.systemWorkspaceId);
    const extensions = createTypedRpcServiceClient(
      system.client.transport,
      { targetId: "main", namespace: "extensions" },
      extensionsMethods,
    );
    const templates = createTypedServiceClient(
      "@workspace-extensions/templates",
      templatesMethods,
      (extension, method, args) => extensions.invoke(extension, method, args),
    );
    return templates.inspect(locator);
  }

  async pendingWorkspaceCreation() {
    const profile = await this.hubControl.getProfile(undefined);
    if (!profile) throw new Error("The authenticated account is unavailable.");
    return readWorkspaceCreationSubmission(
      await getNativeAppStorage().getItem(
        `workspace-creation:${profile.userId}`,
      ),
    );
  }

  async createWorkspace(
    name: string,
    rootTemplate?: TemplateExactPin,
  ): Promise<WorkspaceCreationReceipt> {
    const profile = await this.hubControl.getProfile(undefined);
    if (!profile)
      throw new Error(
        "The authenticated account is unavailable; workspace creation was not submitted.",
      );
    const storage = getNativeAppStorage();
    const receipt = await submitWorkspaceCreation(
      this.hubControl,
      {
        workspace: name,
        ...(rootTemplate ? { rootTemplate } : {}),
      },
      {
        key: `workspace-creation:${profile.userId}`,
        getItem: (key) => storage.getItem(key),
        setItem: (key, value) => storage.setItem(key, value),
        removeItem: (key) => storage.removeItem(key),
        newOperationId: () => crypto.randomUUID(),
      },
    );
    await this.refresh();
    return receipt;
  }

  async createPanel(workspaceId: string): Promise<void> {
    await this.activate(workspaceId);
    const session = await this.open(workspaceId);
    const panel = await session.client.panels.createAboutPanel("new");
    await session.client.panels.focus(panel.id);
  }

  async openPanelSource(
    workspaceId: string,
    source: string,
    options: Parameters<ShellClient["panels"]["createRootPanel"]>[1],
  ): Promise<void> {
    await this.activate(workspaceId);
    const session = await this.open(workspaceId);
    // A destination owns its tree; source panel IDs never become target parents.
    const panel = await session.client.panels.createRootPanel(source, options);
    await session.client.panels.focus(panel.id);
  }

  /** Every panel-link carrier resolves destinations against this account's catalog. */
  async openPanelLocation(location: PanelLocation): Promise<void> {
    const target = resolvePanelWorkspace(
      location.workspace,
      this.entries,
      this.activeWorkspaceId,
    );
    const session = await this.open(target.workspaceId);
    await this.activate(target.workspaceId);
    const panels = session.client.panels;
    const focused = panels.registry.getFocusedPanelId();
    const common = {
      ref: location.ref,
      contextId: location.contextId,
      stateArgs: location.stateArgs,
      placement: location.placement,
    };
    if (location.disposition === "current" && focused) {
      await panels.navigatePanel(focused, location.source, common);
    } else if (location.disposition === "child" && focused) {
      await panels.createChildPanel(focused, location.source, {
        ...common,
        title: location.title,
        slug: location.slug,
        focus: location.focus ?? true,
      });
    } else {
      await panels.createRootPanel(location.source, {
        ...common,
        title: location.title,
        slug: location.slug,
        focus: location.focus ?? true,
      });
    }
  }

  async clearBrowserCookies(workspaceId: string): Promise<void> {
    if (
      this.disposed ||
      !this.entries.some((entry) => entry.workspaceId === workspaceId)
    ) {
      throw new Error("You no longer have access to this workspace");
    }
    await clearWorkspaceCookies(
      `${this.serverEndpointId}:${this.deviceId}`,
      workspaceId,
    );
  }

  updateApprovalCount(workspaceId: string, count: number): void {
    if (this.pendingApprovalCounts.get(workspaceId) === count) return;
    this.pendingApprovalCounts.set(workspaceId, count);
    this.changed();
  }

  get approvalCount(): number {
    return (
      actionableRuntimeApprovals(this.hubApproval.approvals ?? []).length +
      [...this.pendingApprovalCounts.values()].reduce(
        (sum, count) => sum + count,
        0,
      )
    );
  }

  async resolveNotificationWorkspace(
    scope: WorkspacePushScope,
  ): Promise<MobileWorkspaceSession> {
    const system = this.sessions.get(this.systemWorkspaceId)?.client;
    if (!system) throw new Error("Your account is not connected");
    const profile = await system.refreshAccountProfile();
    if (
      scope.serverId !== system.transport.serverId ||
      scope.userId !== profile.userId
    ) {
      throw new Error("This notification belongs to another account");
    }
    return this.open(scope.workspaceId);
  }

  async openApproval(target: WorkspaceApprovalTarget): Promise<void> {
    await this.requestApproval(target.workspaceId, target.approvalId, () =>
      this.resolveNotificationWorkspace(target),
    );
  }

  get unloadedApprovalWorkspaces() {
    return this.entries.flatMap((entry) => {
      if (!(this.pendingApprovalCounts.get(entry.workspaceId) ?? 0)) return [];
      const session = this.sessions.get(entry.workspaceId);
      if (
        session?.state === "ready" &&
        session.approvalStatus === "ready" &&
        !session.approvalError
      )
        return [];
      const state = !session
        ? "unopened"
        : session.state === "failed" || session.approvalError
          ? "failed"
          : "loading";
      return [{ entry, state }];
    });
  }

  openApprovals(workspaceId?: string): void {
    const pendingOwners = [...this.pendingApprovalCounts]
      .filter(([, count]) => count > 0)
      .map(([id]) => id);
    const target =
      workspaceId ?? (this.selectedApproval ? undefined : pendingOwners[0]);
    this.requestedApproval = target ? { workspaceId: target } : null;
    this.approvalPresentation = { ...this.approvalPresentation, open: true };
    // Opening the shared queue connects its pending owners, without presenting
    // their panel trees or changing the user's focused workspace.
    for (const ownerId of new Set([
      ...pendingOwners,
      ...(target ? [target] : []),
    ])) {
      void this.open(ownerId)
        .then(async (session) => {
          if (session.approvalError) {
            session.approvalError = null;
            this.changed();
            await session.approvalState?.refresh("manual");
          }
        })
        .catch(() => this.changed());
    }
    this.changed();
  }

  selectApproval(workspaceId: string, approvalId: string): Promise<void> {
    return this.requestApproval(workspaceId, approvalId, () =>
      this.open(workspaceId),
    );
  }

  private async requestApproval(
    workspaceId: string,
    approvalId: string,
    resolveSession: () => Promise<MobileWorkspaceSession>,
  ): Promise<void> {
    const request: NonNullable<MobileWorkspaceDirectory["requestedApproval"]> =
      { workspaceId, approvalId, phase: "loading" };
    this.requestedApproval = request;
    // Verification/loading owns an intent, not authority to show another
    // request. Later Close, Next, or Open gestures retire this exact intent.
    try {
      const session = await resolveSession();
      if (this.requestedApproval !== request) return;
      await session.approvalState?.refresh("manual");
      if (this.requestedApproval !== request) return;
      if (
        this.sessions.get(workspaceId) !== session ||
        !session.approvals?.some(
          (approval) => approval.approvalId === approvalId,
        )
      ) {
        throw new Error("This review is no longer pending.");
      }
      delete request.phase;
      this.changed();
    } catch (error) {
      if (this.requestedApproval !== request) return;
      this.requestedApproval = null;
      this.changed();
      throw error;
    }
  }

  closeApprovals(): void {
    this.requestedApproval = null;
    this.approvalPresentation = { ...this.approvalPresentation, open: false };
    this.changed();
  }

  dispose(): Promise<void> {
    this.closing ??= this.close();
    return this.closing;
  }

  private async close(): Promise<void> {
    this.disposed = true;
    this.stopWorkspaceCatalog?.();
    this.stopWorkspaceCatalog = null;
    const sessions = [...this.sessions.values()];
    const workspaceApprovalOwners = new Map(this.workspaceApprovalOwners);
    for (const session of sessions) {
      session.stopApprovalRecovery?.();
    }
    this.sessions.clear();
    this.workspaceApprovalOwners.clear();
    const startupOperations = [...this.startupOperations];
    const approvalRetirements = [...this.approvalRetirements];
    const approvalOwnership = [...this.approvalReplacements.values()];
    const approvalReplacements = [...this.approvalReplacementReceipts.values()];
    const results: PromiseSettledResult<unknown>[] = await Promise.allSettled([
      ...(this.hubApproval.approvalState
        ? [this.retireApprovalState(this.hubApproval)]
        : []),
      ...sessions.map(async (session) => {
        const owner = workspaceApprovalOwners.get(session.workspaceId);
        if (owner) await this.retireWorkspaceOwner(owner, session.client);
        else await session.client.close();
      }),
    ]);
    results.push(...(await Promise.allSettled(startupOperations)));
    results.push(...(await Promise.allSettled(approvalRetirements)));
    results.push(...(await Promise.allSettled(approvalOwnership)));
    results.push(...(await Promise.allSettled(approvalReplacements)));
    results.push(
      ...(await Promise.allSettled([this.hubApproval.events.unsubscribeAll()])),
    );
    results.push(...(await Promise.allSettled([this.account.close()])));
    this.changed();
    const failures = results.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    );
    if (failures.length)
      throw new MobileConnectionAggregateError(
        failures,
        "Unable to close all mobile workspace resources",
      );
  }
}

/** Open this client's account through the host and bring its directory up. */
export async function createMobileWorkspaceDirectory(
  api: RnClientApi,
  signal?: AbortSignal,
): Promise<MobileWorkspaceDirectory> {
  const account = await api.session.openAccount();
  let directory: MobileWorkspaceDirectory;
  try {
    directory = new MobileWorkspaceDirectory(account);
  } catch (error) {
    await account.close();
    throw error;
  }
  const onAbort = () => {
    void directory
      .dispose()
      .catch((error) =>
        console.warn(
          "[WorkspaceDirectory] Cancelled connection cleanup failed",
          error,
        ),
      );
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    if (signal?.aborted) throw new Error("Connection cancelled");
    await directory.init();
    return directory;
  } catch (error) {
    await directory.dispose();
    throw error;
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
}
