import type { Panel } from "@vibestudio/shared/types";
import { getCurrentSnapshot } from "@vibestudio/shared/panel/accessors";
import {
  formatPanelRuntimeLeaseDeniedMessage,
  type PanelRuntimeAcquireResult,
} from "@vibestudio/shared/panel/panelLease";
import {
  asPanelEntityId,
  type PanelEntityId,
} from "@vibestudio/shared/panel/ids";
import { buildPanelUrl, type HostConfig } from "./panelUrls";

export interface MobileMaterializedPanel {
  panelId: string;
  runtimeEntityId: PanelEntityId;
  connectionId: string;
  url: string;
  managed: boolean;
  panelInit: unknown;
}

/** The materialization owner retains its terminal cause until work has joined. */
export class PanelMaterializationLifetime {
  private retirement: Error | null = null;

  get retired(): boolean {
    return this.retirement !== null;
  }

  retire(cause: Error): void {
    this.retirement ??= cause;
  }

  assertActive(): void {
    if (this.retirement) throw this.retirement;
  }
}

export interface MobilePanelMaterializationDeps {
  panelId: string;
  lifetime: PanelMaterializationLifetime;
  hostConfig: HostConfig;
  getPanelInit(panelId: string): Promise<unknown>;
  acquireLease(
    panelId: string,
    runtimeEntityId: PanelEntityId,
  ): Promise<PanelRuntimeAcquireResult>;
  takeOverLease(
    panelId: string,
    runtimeEntityId: PanelEntityId,
  ): Promise<PanelRuntimeAcquireResult>;
  leaseMode: "acquire" | "takeOver";
}

function panelInitEntityId(panelInit: unknown): string | null {
  return panelInit &&
    typeof panelInit === "object" &&
    typeof (panelInit as { entityId?: unknown }).entityId === "string"
    ? (panelInit as { entityId: string }).entityId
    : null;
}

/**
 * A loaded WebView is a projection of one immutable panel runtime entity.
 *
 * Build completion and navigation both publish a new runtime identity through
 * the shared tree. The host converges every retained WebView to that identity;
 * visibility is only presentation state and must not control materialization.
 */
export type MobilePanelMaterializationState = "pending" | "needed" | "current";

export function mobilePanelMaterializationState(
  panel: Panel,
  current: { url: string; runtimeEntityId: string | null },
): MobilePanelMaterializationState {
  if (!panel.runtimeEntityId) return "pending";
  const managed = !getCurrentSnapshot(panel).source.startsWith("browser:");
  if (managed && !/^[0-9a-f]{64}$/.test(panel.buildKey ?? "")) return "pending";
  return current.url === "about:blank" ||
    current.runtimeEntityId !== panel.runtimeEntityId
    ? "needed"
    : "current";
}

export function needsMobilePanelMaterialization(
  panel: Panel,
  current: { url: string; runtimeEntityId: string | null },
): boolean {
  return mobilePanelMaterializationState(panel, current) === "needed";
}

/**
 * Mobile workspace app-owned runtime materialization.
 *
 * The server owns persisted panel state. The mobile app owns WebView runtime
 * state: load URLs and host-injected panel identity.
 */
export async function materializeMobilePanel(
  opts: MobilePanelMaterializationDeps & { panel: Panel },
): Promise<MobileMaterializedPanel> {
  const checkActive = () => {
    opts.lifetime.assertActive();
  };
  checkActive();
  const snapshot = getCurrentSnapshot(opts.panel);
  const managed = !snapshot.source.startsWith("browser:");
  const acquireLease = (runtimeEntityId: PanelEntityId) =>
    opts.leaseMode === "takeOver"
      ? opts.takeOverLease(opts.panelId, runtimeEntityId)
      : opts.acquireLease(opts.panelId, runtimeEntityId);
  if (managed && !/^[0-9a-f]{64}$/.test(opts.panel.buildKey ?? "")) {
    if (!opts.panel.runtimeEntityId) {
      throw new Error(
        `Panel ${opts.panelId} did not provide a reserved runtime entity id`,
      );
    }
    const runtimeEntityId = asPanelEntityId(opts.panel.runtimeEntityId);
    const lease = await acquireLease(runtimeEntityId);
    checkActive();
    if (!lease.acquired) {
      throw new Error(
        formatPanelRuntimeLeaseDeniedMessage(opts.panelId, lease.lease),
      );
    }
    return {
      panelId: opts.panelId,
      runtimeEntityId,
      connectionId: lease.lease.connectionId,
      url: "about:blank",
      managed: true,
      panelInit: null,
    };
  }
  const panelInit = await opts.getPanelInit(opts.panelId);
  checkActive();
  const rawEntityId = panelInitEntityId(panelInit);
  if (!rawEntityId) {
    throw new Error(
      `Panel ${opts.panelId} did not provide a runtime entity id`,
    );
  }
  // Validate the SHAPE here (throws loudly on a slot id "panel:tree/…" where an
  // entity id "panel:nav-…" is required) so the slot/entity mix-up cannot reach
  // the lease + grant as a laundered raw string — the brand then enforces it
  // through acquireLease → retained runtime owner → openPanelSession at compile
  // time.
  const runtimeEntityId: PanelEntityId = asPanelEntityId(rawEntityId);
  if (runtimeEntityId !== opts.panel.runtimeEntityId) {
    throw new Error(
      `Panel ${opts.panelId} changed runtime identity while it was being materialized`,
    );
  }
  const lease = await acquireLease(runtimeEntityId);
  checkActive();
  if (!lease.acquired) {
    throw new Error(
      formatPanelRuntimeLeaseDeniedMessage(opts.panelId, lease.lease),
    );
  }
  if (!managed) {
    return {
      panelId: opts.panelId,
      runtimeEntityId,
      connectionId: lease.lease.connectionId,
      url: snapshot.source.slice("browser:".length),
      managed: false,
      panelInit: null,
    };
  }
  if (
    String(lease.lease.slotId) !== opts.panelId ||
    String(lease.lease.runtimeEntityId) !== runtimeEntityId
  ) {
    throw new Error(
      `Panel ${opts.panelId} acquired a lease for a different panel runtime`,
    );
  }
  return {
    panelId: opts.panelId,
    runtimeEntityId,
    connectionId: lease.lease.connectionId,
    url: buildPanelUrl(
      snapshot.source,
      snapshot.contextId,
      opts.panel.buildKey ?? "",
      opts.hostConfig,
    ),
    managed: true,
    panelInit:
      panelInit && typeof panelInit === "object"
        ? {
            ...(panelInit as Record<string, unknown>),
            connectionId: lease.lease.connectionId,
            clientLabel: "Mobile",
          }
        : panelInit,
  };
}

export function materializationCoordinate(panel: Panel): string {
  const snapshot = getCurrentSnapshot(panel);
  return JSON.stringify({
    runtimeEntityId: panel.runtimeEntityId ?? null,
    buildKey: panel.buildKey ?? null,
    source: snapshot.source,
    contextId: snapshot.contextId,
  });
}

/**
 * Materialize one coherent live panel incarnation.
 *
 * `getPanelInit` and lease acquisition cross the host boundary, so navigation
 * or build completion may replace the panel while either is in flight. Retry
 * from the new authoritative snapshot instead of ever pairing one incarnation's
 * URL with another incarnation's runtime identity.
 */
export async function materializeLatestMobilePanel(
  opts: MobilePanelMaterializationDeps & { getPanel(): Panel | null },
): Promise<MobileMaterializedPanel> {
  while (true) {
    opts.lifetime.assertActive();
    const panel = opts.getPanel();
    if (!panel) throw new Error(`Panel ${opts.panelId} no longer exists`);
    const expectedCoordinate = materializationCoordinate(panel);

    let materialized: MobileMaterializedPanel;
    try {
      materialized = await materializeMobilePanel({ ...opts, panel });
    } catch (error) {
      if (opts.lifetime.retired) throw error;
      const current = opts.getPanel();
      if (current && materializationCoordinate(current) !== expectedCoordinate)
        continue;
      throw error;
    }

    const current = opts.getPanel();
    if (!current) throw new Error(`Panel ${opts.panelId} no longer exists`);
    if (
      materialized.runtimeEntityId !== panel.runtimeEntityId ||
      materializationCoordinate(current) !== expectedCoordinate
    ) {
      continue;
    }
    return materialized;
  }
}

interface PanelMaterializationTask {
  coordinate: string;
  mode: "acquire" | "takeOver";
  lifetime: PanelMaterializationLifetime;
  completion: Promise<void>;
  running: boolean;
  failed: boolean;
}

/** One retained slot owns one operation until its actual work has joined. */
export class PanelMaterializationTasks {
  private readonly tasks = new Map<string, PanelMaterializationTask>();

  constructor(private readonly settled: () => void) {}

  has(panelId: string): boolean {
    return this.tasks.get(panelId)?.running ?? false;
  }

  isTakingOver(panelId: string): boolean {
    const task = this.tasks.get(panelId);
    return !!task?.running && task.mode === "takeOver";
  }

  start(
    panelId: string,
    currentCoordinate: () => string,
    mode: "acquire" | "takeOver",
    work: (lifetime: PanelMaterializationLifetime) => Promise<void>,
  ): Promise<void> | null {
    const previous = this.tasks.get(panelId);
    if (previous?.running) return null;
    const coordinate = currentCoordinate();
    if (previous?.failed && previous.coordinate === coordinate) return null;
    const task: PanelMaterializationTask = {
      coordinate,
      mode,
      lifetime: new PanelMaterializationLifetime(),
      completion: Promise.resolve(),
      running: true,
      failed: false,
    };
    this.tasks.set(panelId, task);
    task.completion = Promise.resolve()
      .then(() => work(task.lifetime))
      .catch((error: unknown) => {
        task.coordinate = currentCoordinate();
        task.failed = true;
        throw error;
      })
      .finally(() => {
        task.running = false;
        if (!task.failed || task.lifetime.retired)
          this.tasks.delete(panelId);
        this.settled();
      });
    // The caller presents the original failure; retirement also owns completion.
    void task.completion.catch(() => {});
    return task.completion;
  }

  retry(panelId: string): void {
    if (!this.tasks.get(panelId)?.running) this.tasks.delete(panelId);
  }

  retainOnly(panelIds: ReadonlySet<string>): void {
    for (const [panelId, task] of this.tasks) {
      if (panelIds.has(panelId)) continue;
      task.lifetime.retire(
        new Error(`Panel ${panelId} is no longer retained`),
      );
      if (!task.running) this.tasks.delete(panelId);
    }
  }

  async stop(): Promise<void> {
    this.retainOnly(new Set());
    await Promise.allSettled(
      [...this.tasks.values()].map((task) => task.completion),
    );
  }
}
