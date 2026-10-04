import { randomBytes, randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import {
  createServer as createHttpServer,
  type IncomingMessage,
} from "node:http";
import { createServer as createNetServer } from "node:net";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import type {
  EngineState,
  ModelRecord,
  ModelRuntimeConfig,
  ModelRuntimeValidationRecipe,
  OwnerInfo,
  OwnershipRole,
  ServerKind,
  ServerState,
} from "@workspace/model-catalog/localModels";
import { ServerReadiness } from "./server-readiness.js";
import {
  effectiveModelRuntime,
  observedRuntimeRecipe,
  modelRuntimeArgs,
  validatedRuntimeConfig,
} from "./runtime-profiles.js";
import { FALLBACK_MODEL, ROOT_LAYOUT } from "./constants.js";

export interface SupervisorDeps {
  rootDir: string;
  workspaceId: string;
  spawn(
    bin: string,
    args: string[],
    opts: {
      env: Record<string, string>;
      onExit(code: number | null): void;
      onStdout(line: string): void;
      onStderr(line: string): void;
    },
  ): { pid: number; kill(signal?: string): void; closed: Promise<void> };
  fetch: typeof fetch;
  log(msg: string, data?: unknown): void;
  emit(
    event:
      | { kind: "server.state"; server: ServerKind; state: ServerState }
      | { kind: "models.changed" },
  ): void;
  engines(): EngineState | null;
  fallbackModel(): Promise<ModelRecord | null>;
  libraryModel(slug: string): Promise<ModelRecord | null>;
  /** Full library — feeds the router preset INI (design §4.4). */
  libraryModels(): Promise<ModelRecord[]>;
  now(): number;
  /** Kill a foreign pid (dead-owner orphan reaping); defaults injected by the
   *  extension wiring as process.kill(pid, "SIGTERM"). */
  killPid?(pid: number): void;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
  adminTransport?: SupervisorAdminTransport;
}

export type SupervisorAdminCommand =
  | { kind: "ensure-loaded"; slug: string }
  | { kind: "restart"; server: ServerKind }
  | { kind: "status" };

export type SupervisorAdminResult =
  | { baseUrl: string; runtimeConfig: ModelRuntimeConfig }
  | { ok: true }
  | { servers: Record<ServerKind, ServerState> };

export interface SupervisorAdminTransport {
  listen(
    port: number,
    apiKey: string,
    handler: (
      command: SupervisorAdminCommand,
    ) => Promise<SupervisorAdminResult>,
  ): Promise<{ close(): Promise<void> | void }>;
  request(
    port: number,
    apiKey: string,
    command: SupervisorAdminCommand,
  ): Promise<SupervisorAdminResult>;
}

type SpawnedProcess = {
  pid: number;
  kill(signal?: string): void;
  closed: Promise<void>;
};
type TimerHandle = ReturnType<typeof setTimeout>;
type ServerEvent = "stdout" | "stderr";

interface PersistedConfig {
  utilityPort: number;
  mainPort: number;
  adminPort?: number;
}

interface RuntimeProcess {
  token: number;
  child: SpawnedProcess;
  readiness: ServerReadiness;
  recipe: string;
  expectedExit: boolean;
  eaddrInUse: boolean;
}

interface ServerRuntime {
  state: ServerState;
  process: RuntimeProcess | null;
  restartTimer: TimerHandle | null;
  failureTimes: number[];
  startedAt: number | null;
  launchFlight?: Promise<RuntimeProcess | undefined>;
  exitFlight?: Promise<void>;
  stopFlight?: Promise<void>;
}

const FAILURE_WINDOW_MS = 60_000;
const MAIN_FAILURE_LIMIT = 5;
const MAIN_MAX_BACKOFF_MS = 16_000;
const UTILITY_MAX_BACKOFF_MS = 60_000;
const IDLE_UNLOAD_MS = 15 * 60_000;
const RING_LINES = 500;

const SERVER_KINDS: ServerKind[] = ["utility", "main"];

export function createServerSupervisor(deps: SupervisorDeps): {
  activate(): Promise<void>;
  role(): OwnershipRole;
  ownerInfo(): OwnerInfo | null;
  status(): Promise<Record<ServerKind, ServerState>>;
  ensureLoaded(
    slug: string,
  ): Promise<{ baseUrl: string; runtimeConfig: ModelRuntimeConfig }>;
  validateModel(
    slug: string,
    config?: ModelRuntimeConfig,
  ): Promise<{
    baseUrl: string;
    toolsCapable: boolean;
    recipe: ModelRuntimeValidationRecipe;
  }>;
  validationRecipe(model: ModelRecord): ModelRuntimeValidationRecipe;
  apiKey(): Promise<string>;
  restart(kind: ServerKind): Promise<void>;
  tailLog(kind: ServerKind, lines?: number): string[];
  dispose(reason?: unknown): Promise<void>;
} {
  return new ServerSupervisor(deps).api();
}

class ServerSupervisor {
  private readonly rootDir: string;
  private readonly paths: {
    lock: string;
    owner: string;
    authKey: string;
    config: string;
    models: string;
  };
  private readonly setTimeoutFn: typeof setTimeout;
  private readonly clearTimeoutFn: typeof clearTimeout;
  private roleValue: OwnershipRole = "attached";
  private ownerInfoValue: OwnerInfo | null = null;
  private lockFd: number | null = null;
  private bootId = "";
  private keyCache: string | null = null;
  private ports: { utility: number; main: number } | null = null;
  private adminPort: number | null = null;
  private adminListener: { close(): Promise<void> | void } | null = null;
  private activated = false;
  private disposed = false;
  private disposalReason: unknown = new Error(
    "Local-models supervisor is disposed",
  );
  private activationFlight: Promise<void> | undefined;
  private disposalFlight: Promise<void> | undefined;
  private readonly ownedProcesses = new Set<SpawnedProcess>();
  private readonly readiness = new Set<ServerReadiness>();
  private readonly exitFlights = new Set<Promise<void>>();
  private nextProcessToken = 0;
  /**
   * Prefer the fastest smoke-tested engine for the utility server. If that
   * process fails, use the universal CPU build for the rest of this activation;
   * a future activation tries the preferred engine again.
   */
  private utilityCpuFallback = false;
  private idleTimer: TimerHandle | null = null;
  private readonly lastUsed = new Map<string, number>();
  /** Models present in the preset consumed by this supervisor's live router. */
  private routerCatalogModels = new Map<string, string>();
  private mainModelSlug: string | undefined;
  private readonly loadedRecipes = new Map<string, string>();
  private readonly loadFlights: Partial<
    Record<
      ServerKind,
      Promise<{ baseUrl: string; runtimeConfig: ModelRuntimeConfig }>
    >
  > = {};
  /** Models this supervisor has explicitly loaded through the live router. */
  private readonly loadedMainModels = new Set<string>();
  private readonly logs: Record<ServerKind, string[]> = {
    utility: [],
    main: [],
  };
  private readonly servers: Record<ServerKind, ServerRuntime> = {
    utility: this.createRuntime(),
    main: this.createRuntime(),
  };

  constructor(private readonly deps: SupervisorDeps) {
    this.rootDir = deps.rootDir;
    this.paths = {
      lock: join(deps.rootDir, ROOT_LAYOUT.ownerLock),
      owner: join(deps.rootDir, ROOT_LAYOUT.ownerInfo),
      authKey: join(deps.rootDir, ROOT_LAYOUT.authKey),
      config: join(deps.rootDir, ROOT_LAYOUT.config),
      models: join(deps.rootDir, ROOT_LAYOUT.modelsDir),
    };
    this.setTimeoutFn = deps.setTimeoutFn ?? setTimeout;
    this.clearTimeoutFn = deps.clearTimeoutFn ?? clearTimeout;
  }

  api(): {
    activate(): Promise<void>;
    role(): OwnershipRole;
    ownerInfo(): OwnerInfo | null;
    status(): Promise<Record<ServerKind, ServerState>>;
    ensureLoaded(
      slug: string,
    ): Promise<{ baseUrl: string; runtimeConfig: ModelRuntimeConfig }>;
    validateModel(
      slug: string,
      config?: ModelRuntimeConfig,
    ): Promise<{
      baseUrl: string;
      toolsCapable: boolean;
      recipe: ModelRuntimeValidationRecipe;
    }>;
    validationRecipe(model: ModelRecord): ModelRuntimeValidationRecipe;
    apiKey(): Promise<string>;
    restart(kind: ServerKind): Promise<void>;
    tailLog(kind: ServerKind, lines?: number): string[];
    dispose(reason?: unknown): Promise<void>;
  } {
    return {
      activate: () => this.activate(),
      role: () => this.roleValue,
      ownerInfo: () => this.ownerInfoValue,
      status: () => this.status(),
      ensureLoaded: (slug) => this.ensureLoaded(slug),
      validateModel: (slug, config) => this.validateModel(slug, config),
      validationRecipe: (model) =>
        observedRuntimeRecipe(
          this.recipeFor(
            model.slug === FALLBACK_MODEL.slug ? "utility" : "main",
            model,
          ),
        ),
      apiKey: () => this.publicApiKey(),
      restart: (kind) => this.restart(kind),
      tailLog: (kind, lines) => this.tailLog(kind, lines),
      dispose: (reason) => this.dispose(reason),
    };
  }

  private createRuntime(): ServerRuntime {
    return {
      state: { state: "stopped" },
      process: null,
      restartTimer: null,
      failureTimes: [],
      startedAt: null,
    };
  }

  private activate(): Promise<void> {
    if (this.disposed) return Promise.reject(this.disposalReason);
    if (this.activated) return Promise.resolve();
    return (this.activationFlight ??= (async () => {
      mkdirSync(this.rootDir, { recursive: true });
      mkdirSync(this.paths.models, { recursive: true });
      await this.acquireOrAttach(false);
      this.activated = true;
    })());
  }

  private spawnOwned(
    ...args: Parameters<SupervisorDeps["spawn"]>
  ): SpawnedProcess {
    if (this.disposed) throw this.disposalReason;
    const child = this.deps.spawn(...args);
    this.ownedProcesses.add(child);
    // A process handle remains owned while termination is in flight, even if a restart
    // already detached it from the currently serving slot. A closed spawn failure is
    // a terminal operation outcome; readiness delivers it without retaining fake cleanup debt.
    void child.closed.then(
      () => this.ownedProcesses.delete(child),
      () => this.ownedProcesses.delete(child),
    );
    return child;
  }

  private async acquireOrAttach(retried: boolean): Promise<void> {
    const acquired = await this.tryAcquireOwner();
    if (acquired) return;

    const owner = this.readOwnerInfo();
    // Owner liveness is keyed on the process, not on a utility health probe:
    // with the lazy fallback (design §5) the owner's utility server is cold by
    // default, so a health probe would false-negative a perfectly live owner.
    if (owner && pidAlive(owner.pid)) {
      this.roleValue = "attached";
      this.ownerInfoValue = owner;
      this.ports = owner.ports;
      this.adminPort = owner.adminPort ?? null;
      return;
    }

    if (!retried && (!owner || !pidAlive(owner.pid))) {
      // Dead owner: reap any server processes it left behind (verified live —
      // llama-server children survive an abrupt host exit) so the takeover
      // doesn't leak orphans or fight them for the persisted ports.
      if (owner?.serverPids) {
        for (const pid of Object.values(owner.serverPids)) {
          if (typeof pid === "number" && pid > 0 && pidAlive(pid)) {
            try {
              this.deps.killPid?.(pid);
            } catch {
              // reaped concurrently or not ours — EADDRINUSE reallocation covers it
            }
          }
        }
      }
      rmSync(this.paths.lock, { force: true });
      rmSync(this.paths.owner, { force: true });
      await this.acquireOrAttach(true);
      return;
    }

    if (owner) {
      this.roleValue = "attached";
      this.ownerInfoValue = owner;
      this.ports = owner.ports;
      this.adminPort = owner.adminPort ?? null;
      return;
    }

    throw new Error(
      "local-models owner lock exists but owner metadata is unavailable",
    );
  }

  private async tryAcquireOwner(): Promise<boolean> {
    let fd: number;
    try {
      fd = openSync(this.paths.lock, "wx", 0o600);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EEXIST") return false;
      throw error;
    }

    this.lockFd = fd;
    this.bootId = readBootId();
    writeSync(fd, JSON.stringify({ pid: process.pid, bootId: this.bootId }));

    try {
      this.roleValue = "owner";
      const config = await this.loadOrCreatePorts();
      this.ports = { utility: config.utilityPort, main: config.mainPort };
      this.adminPort = config.adminPort;
      const apiKey = await this.ensureApiKeyFile();
      await this.startAdminListener(apiKey);
      this.writeOwnerInfo();
      // Servers stay cold: the fallback floor is lazy (design §5), so the
      // utility server starts on the first ensureLoaded(fallback), not here.
      return true;
    } catch (error) {
      closeSync(fd);
      this.lockFd = null;
      unlinkIfExists(this.paths.owner);
      unlinkIfExists(this.paths.lock);
      throw error;
    }
  }

  private async loadOrCreatePorts(): Promise<Required<PersistedConfig>> {
    const config = this.readConfig();
    if (config) {
      if (validPort(config.adminPort))
        return config as Required<PersistedConfig>;
      const adminPort = await allocatePort([
        config.utilityPort,
        config.mainPort,
      ]);
      const migrated = { ...config, adminPort };
      this.writeConfig(migrated);
      return migrated;
    }

    const utility = await allocatePort();
    const main = await allocatePort(utility);
    const adminPort = await allocatePort([utility, main]);
    const created = { utilityPort: utility, mainPort: main, adminPort };
    this.writeConfig(created);
    return created;
  }

  private readConfig(): PersistedConfig | null {
    const value = readJsonFile<PersistedConfig>(this.paths.config);
    if (!value) return null;
    if (validPort(value.utilityPort) && validPort(value.mainPort)) return value;
    return null;
  }

  private writeConfig(config: PersistedConfig): void {
    writeFileSync(this.paths.config, `${JSON.stringify(config, null, 2)}\n`, {
      mode: 0o600,
    });
  }

  private async startAdminListener(apiKey: string): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (!validPort(this.adminPort) || !this.ports) {
        throw new Error("local-models admin port is not initialized");
      }
      try {
        this.adminListener = await this.adminTransport().listen(
          this.adminPort,
          apiKey,
          (command) => this.handleAdminCommand(command),
        );
        return;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE") throw error;
        this.adminPort = await allocatePort([
          this.ports.utility,
          this.ports.main,
          this.adminPort,
        ]);
        this.writeConfig({
          utilityPort: this.ports.utility,
          mainPort: this.ports.main,
          adminPort: this.adminPort,
        });
      }
    }
    throw new Error(
      "local-models admin endpoint could not acquire a loopback port",
    );
  }

  private writeOwnerInfo(): void {
    if (this.roleValue !== "owner" || !this.ports) return;
    const serverPids: { utility?: number; main?: number } = {};
    for (const kind of ["utility", "main"] as const) {
      const pid = this.servers[kind].process?.child.pid;
      if (typeof pid === "number" && pid > 0) serverPids[kind] = pid;
    }
    const owner: OwnerInfo = {
      schemaVersion: 1,
      pid: process.pid,
      bootId: this.bootId,
      ports: this.ports,
      adminPort: this.adminPort ?? undefined,
      workspaceId: this.deps.workspaceId,
      since: this.ownerInfoValue?.since ?? this.deps.now(),
      serverPids,
    };
    writeFileSync(this.paths.owner, `${JSON.stringify(owner, null, 2)}\n`, {
      mode: 0o600,
    });
    this.ownerInfoValue = owner;
  }

  private readOwnerInfo(): OwnerInfo | null {
    const value = readJsonFile<OwnerInfo>(this.paths.owner);
    if (!value) return null;
    if (
      value.schemaVersion !== 1 ||
      Object.keys(value).some(
        (key) =>
          ![
            "schemaVersion",
            "pid",
            "bootId",
            "ports",
            "adminPort",
            "workspaceId",
            "since",
            "serverPids",
          ].includes(key),
      )
    ) {
      return null;
    }
    if (!validPort(value.ports?.utility) || !validPort(value.ports?.main))
      return null;
    if (value.adminPort !== undefined && !validPort(value.adminPort))
      return null;
    if (!Number.isInteger(value.pid) || typeof value.bootId !== "string")
      return null;
    if (
      typeof value.workspaceId !== "string" ||
      typeof value.since !== "number"
    )
      return null;
    return value;
  }

  private async ensureApiKeyFile(): Promise<string> {
    if (this.keyCache) return this.keyCache;
    if (!existsSync(this.paths.authKey)) {
      const key = randomBytes(32).toString("hex");
      writeFileSync(this.paths.authKey, key, { mode: 0o600 });
      chmodSync(this.paths.authKey, 0o600);
      this.keyCache = key;
      return key;
    }
    const key = this.readApiKeyFile();
    chmodSync(this.paths.authKey, 0o600);
    return key;
  }

  private readApiKeyFile(): string {
    const key = readFileSync(this.paths.authKey, "utf8").trim();
    if (!key) throw new Error("local-models api key is empty");
    this.keyCache = key;
    return key;
  }

  private async publicApiKey(): Promise<string> {
    await this.activate();
    return this.apiKey();
  }

  private async apiKey(): Promise<string> {
    if (this.keyCache) return this.keyCache;
    if (this.roleValue === "owner") return this.ensureApiKeyFile();
    return this.readApiKeyFile();
  }

  private async status(): Promise<Record<ServerKind, ServerState>> {
    await this.activate();
    if (this.roleValue === "attached") {
      await this.ensureAttachedOwnerAlive();
      if (this.roleValue === "attached") {
        const result = await this.requestOwner({ kind: "status" });
        if (!("servers" in result) || !isServerStates(result.servers)) {
          throw new Error(
            "local-models owner returned an invalid status response",
          );
        }
        return result.servers;
      }
    }
    return this.localStatus();
  }

  private localStatus(): Record<ServerKind, ServerState> {
    return {
      utility: this.currentState("utility"),
      main: this.currentState("main"),
    };
  }

  private currentState(kind: ServerKind): ServerState {
    const runtime = this.servers[kind];
    if (runtime.state.state !== "running") return runtime.state;
    return this.runningState(kind);
  }

  private runningState(kind: ServerKind): ServerState {
    const port = this.portFor(kind);
    const startedAt = this.servers[kind].startedAt ?? this.deps.now();
    return {
      state: "running",
      port,
      loadedModels:
        kind === "utility"
          ? [FALLBACK_MODEL.slug]
          : Array.from(this.loadedMainModels),
      uptimeMs: Math.max(0, this.deps.now() - startedAt),
    };
  }

  private async ensureLoaded(
    inputSlug: string,
  ): Promise<{ baseUrl: string; runtimeConfig: ModelRuntimeConfig }> {
    await this.activate();
    const slug = normalizeSlug(inputSlug);
    if (this.roleValue === "attached") {
      await this.ensureAttachedOwnerAlive();
      if (this.roleValue === "attached") {
        const result = await this.requestOwner({ kind: "ensure-loaded", slug });
        if (!("baseUrl" in result)) {
          throw new Error(
            "local-models owner returned an invalid load response",
          );
        }
        return {
          baseUrl: result.baseUrl,
          runtimeConfig: validatedRuntimeConfig(result.runtimeConfig),
        };
      }
    }
    return this.ensureLoadedAsOwner(slug);
  }

  private ensureLoadedAsOwner(
    slug: string,
  ): Promise<{ baseUrl: string; runtimeConfig: ModelRuntimeConfig }> {
    const kind = slug === FALLBACK_MODEL.slug ? "utility" : "main";
    const previous = this.loadFlights[kind];
    const flight = (
      previous ? previous.catch(() => undefined) : Promise.resolve()
    ).then(() => this.loadAsOwner(slug));
    this.loadFlights[kind] = flight;
    void flight.then(
      () => {
        if (this.loadFlights[kind] === flight) delete this.loadFlights[kind];
      },
      () => {
        if (this.loadFlights[kind] === flight) delete this.loadFlights[kind];
      },
    );
    return flight;
  }

  private async loadAsOwner(
    slug: string,
  ): Promise<{ baseUrl: string; runtimeConfig: ModelRuntimeConfig }> {
    if (this.disposed) throw this.disposalReason;
    if (this.roleValue !== "owner")
      throw new Error("local-models supervisor is attached");
    if (slug === FALLBACK_MODEL.slug) {
      const source = await this.deps.fallbackModel();
      if (!source) throw new Error(`local model not found: ${slug}`);
      const model = {
        ...source,
        config: validatedRuntimeConfig(source.config),
      };
      await this.reconcileRecipe("utility", model);
      this.markUsed(slug);
      const active = await this.ensureOwnerServer("utility", model);
      await this.assertHealthy("utility", active);
      return {
        baseUrl: baseUrl(this.portFor("utility")),
        runtimeConfig: validatedRuntimeConfig(model.config),
      };
    }

    const source = await this.deps.libraryModel(slug);
    if (!source) throw new Error(`local model not found: ${slug}`);
    const model = { ...source, config: validatedRuntimeConfig(source.config) };

    this.mainModelSlug = slug;
    await this.reconcileRecipe("main", model);
    const active = await this.ensureOwnerServer("main", model);
    await this.assertHealthy("main", active);

    this.markUsed(slug);
    await this.ensureRouterModelLoaded(model);
    return {
      baseUrl: baseUrl(this.portFor("main")),
      runtimeConfig: validatedRuntimeConfig(model.config),
    };
  }

  private recipeFor(kind: ServerKind, model: ModelRecord) {
    const engines = this.deps.engines();
    return effectiveModelRuntime(
      model,
      kind === "utility" && this.utilityCpuFallback && engines
        ? { ...engines, gpu: null }
        : engines,
    );
  }

  private async reconcileRecipe(
    kind: ServerKind,
    model: ModelRecord,
  ): Promise<void> {
    const runtime = this.servers[kind];
    if (runtime.launchFlight) await runtime.launchFlight;
    if (runtime.exitFlight) await runtime.exitFlight;
    const recipe = this.recipeFor(kind, model);
    const identity = kind === "utility" ? JSON.stringify(recipe) : recipe.bin;
    const loaded = this.loadedRecipes.get(model.slug);
    if (
      runtime.process &&
      (runtime.process.recipe !== identity ||
        (loaded !== undefined && loaded !== JSON.stringify(recipe)))
    ) {
      this.clearRestartTimer(kind);
      await this.stopProcess(kind, "SIGTERM");
    }
  }

  /**
   * Keep the running llama.cpp router synchronized with the shared model
   * library, then explicitly load the requested model before advertising it as
   * ready. Router presets are read at startup; llama.cpp requires a
   * `GET /models?reload=1` after a new preset entry is written.
   *
   * Only the owner performs router mutations. Attached workspaces forward the
   * complete load request through the authenticated admin endpoint.
   */
  private async ensureRouterModelLoaded(model: ModelRecord): Promise<void> {
    const slug = model.slug;
    const key = await this.apiKey();
    const endpoint = `http://127.0.0.1:${this.portFor("main")}`;
    const recipe = JSON.stringify(this.recipeFor("main", model));
    if (this.routerCatalogModels.get(slug) !== recipe) {
      const presetPath = await this.writeRouterPreset(model);
      if (!presetPath || !this.routerCatalogModels.has(slug)) {
        throw new Error(
          `local model ${slug} is missing from the router preset`,
        );
      }
      const reload = await this.deps.fetch(`${endpoint}/models?reload=1`, {
        method: "GET",
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!reload.ok) {
        throw new Error(
          `local model router catalog refresh failed with HTTP ${reload.status}`,
        );
      }
    }

    if (this.loadedMainModels.has(slug)) return;
    const load = await this.deps.fetch(`${endpoint}/models/load`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ model: slug }),
    });
    if (!load.ok) {
      const detail = await load.text().catch(() => "");
      throw new Error(
        `local model ${slug} failed to load with HTTP ${load.status}${detail ? `: ${detail}` : ""}`,
      );
    }
    // --models-max 1 makes this the only resident main model.
    this.loadedMainModels.clear();
    this.loadedMainModels.add(slug);
    this.loadedRecipes.clear();
    this.loadedRecipes.set(slug, recipe);
  }

  private async validateModel(
    inputSlug: string,
    config?: ModelRuntimeConfig,
  ): Promise<{
    baseUrl: string;
    toolsCapable: boolean;
    recipe: ModelRuntimeValidationRecipe;
  }> {
    await this.activate();
    const slug = normalizeSlug(inputSlug);
    const model =
      slug === FALLBACK_MODEL.slug
        ? await this.deps.fallbackModel()
        : await this.deps.libraryModel(slug);
    if (!model) throw new Error(`local model not found: ${slug}`);

    const recipe = this.recipeFor(
      slug === FALLBACK_MODEL.slug ? "utility" : "main",
      config ? { ...model, config: validatedRuntimeConfig(config) } : model,
    );

    // Installation validation is deliberately isolated from the shared,
    // workspace-owned serving processes. Any workspace can add a model without
    // taking over or restarting another workspace's warm router.
    const port = await allocatePort();
    const stderr: string[] = [];
    const readiness = this.processReadiness(port);
    const child = this.spawnOwned(
      recipe.bin,
      [
        "-m",
        model.file,
        "--port",
        String(port),
        "--host",
        "127.0.0.1",
        "--api-key-file",
        this.paths.authKey,
        ...modelRuntimeArgs(recipe),
        "--jinja",
        "-np",
        "1",
      ],
      {
        env: cleanEnv(),
        onExit: (code) => {
          readiness.fail(
            new Error(
              `local model ${slug} validation server exited with code ${String(code)}${stderr.at(-1) ? `: ${stderr.at(-1)}` : ""}`,
            ),
          );
        },
        onStdout: (line) => {
          readiness.observe(line);
        },
        onStderr: (line) => {
          stderr.push(line);
          if (stderr.length > 20) stderr.shift();
          readiness.observe(line);
        },
      },
    );

    let failure: unknown;
    try {
      readiness.start();
      void child.closed.then(
        () =>
          readiness.fail(
            new Error(`local model ${slug} validation server closed`),
          ),
        (error) => readiness.fail(error),
      );
      await readiness.ready;
      const toolsCapable = await this.assertModelRuntime(port, model);
      return {
        baseUrl: baseUrl(port),
        toolsCapable,
        recipe: observedRuntimeRecipe(recipe),
      };
    } catch (error) {
      failure = error;
      throw error;
    } finally {
      try {
        child.kill("SIGTERM");
        await child.closed;
        await readiness.join();
        this.readiness.delete(readiness);
      } catch (cleanup) {
        if (failure !== undefined)
          throw new AggregateError(
            [failure, cleanup],
            "Local model validation and child closure failed",
            { cause: failure },
          );
        throw cleanup;
      }
    }
  }

  private async ensureAttachedOwnerAlive(): Promise<void> {
    const owner = this.readOwnerInfo();
    if (owner) {
      this.ownerInfoValue = owner;
      this.ports = owner.ports;
      this.adminPort = owner.adminPort ?? null;
    }

    const activeOwner = this.ownerInfoValue;
    if (!activeOwner) throw new Error("local-models owner is unavailable");

    // Liveness is process-based (see acquireOrAttach): the owner's servers are
    // cold until demanded, so utility health is not a liveness signal.
    if (pidAlive(activeOwner.pid)) return;
    await this.acquireOrAttach(false);
  }

  private adminTransport(): SupervisorAdminTransport {
    return this.deps.adminTransport ?? HTTP_ADMIN_TRANSPORT;
  }

  private async requestOwner(
    command: SupervisorAdminCommand,
  ): Promise<SupervisorAdminResult> {
    const port = this.ownerInfoValue?.adminPort ?? this.adminPort;
    if (!validPort(port)) {
      throw new Error(
        "local-models owner predates the admin control plane; restart the owning workspace",
      );
    }
    const key = await this.apiKey();
    return this.adminTransport().request(port, key, command);
  }

  private async handleAdminCommand(
    command: SupervisorAdminCommand,
  ): Promise<SupervisorAdminResult> {
    if (this.roleValue !== "owner")
      throw new Error("local-models supervisor is attached");
    if (command.kind === "ensure-loaded") {
      return this.ensureLoadedAsOwner(normalizeSlug(command.slug));
    }
    if (command.kind === "status") return { servers: this.localStatus() };
    await this.restartAsOwner(command.server);
    return { ok: true };
  }

  private async ensureOwnerServer(
    kind: ServerKind,
    model: ModelRecord,
  ): Promise<RuntimeProcess> {
    if (this.roleValue !== "owner")
      throw new Error("local-models supervisor is attached");
    const runtime = this.servers[kind];
    if (runtime.process) return runtime.process;
    // An admitted exit may already own exact port reallocation/replacement.
    if (runtime.exitFlight) await runtime.exitFlight;
    if (runtime.process) return runtime.process;
    const active = await this.startServer(kind, model);
    if (!active)
      throw this.disposed
        ? this.disposalReason
        : new Error(
            runtime.state.state === "error"
              ? runtime.state.message
              : `${kind} server is unavailable`,
          );
    return active;
  }

  private async assertHealthy(
    kind: ServerKind,
    active: RuntimeProcess,
  ): Promise<void> {
    await active.readiness.ready;
    if (this.servers[kind].process !== active || this.disposed)
      throw this.disposed
        ? this.disposalReason
        : new Error(`${kind} server was withdrawn before readiness admission`);
  }

  private processReadiness(port: number): ServerReadiness {
    const readiness = new ServerReadiness(async (signal) => {
      const key = await this.apiKey();
      signal.throwIfAborted();
      const response = await this.deps.fetch(
        `http://127.0.0.1:${port}/health`,
        {
          method: "GET",
          headers: { Authorization: `Bearer ${key}` },
          signal,
        },
      );
      return response.ok;
    });
    this.readiness.add(readiness);
    return readiness;
  }

  /**
   * A healthy HTTP process and template capability flags are not enough. At
   * add time, a tools-capable model must generate a call that llama.cpp parses
   * into the OpenAI shape, and its embedded template must retain that call when
   * the next turn is rendered. This is deliberately never run on invocation.
   */
  private async assertModelRuntime(
    port: number,
    model: ModelRecord,
  ): Promise<boolean> {
    const key = await this.apiKey();
    const propsResponse = await this.deps.fetch(
      `http://127.0.0.1:${port}/props`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${key}` },
      },
    );
    if (!propsResponse.ok) {
      throw new Error(
        `local model ${model.slug} runtime properties failed with HTTP ${propsResponse.status}`,
      );
    }
    const props = (await propsResponse.json()) as {
      chat_template_caps?: {
        supports_tools?: boolean;
        supports_tool_calls?: boolean;
        supports_object_arguments?: boolean;
      };
    };
    const caps = props.chat_template_caps;
    if (
      caps?.supports_tools !== true ||
      caps.supports_tool_calls !== true ||
      caps.supports_object_arguments !== true
    ) {
      // A GGUF template mentioning tools is not proof of runtime capability.
      // This remains a usable text model; never advertise or offer structured tools.
      return false;
    }

    const assistantCallSentinel = "vibestudio-assistant-call-sentinel";
    const probeTool = {
      type: "function",
      function: {
        name: "vibestudio_runtime_probe",
        description: "Return the supplied compatibility sentinel.",
        parameters: {
          type: "object",
          properties: { value: { type: "string" } },
          required: ["value"],
        },
      },
    };
    // The agent currently exposes roughly this many tools in a normal turn.
    // A one-tool probe admits small models that can serialize a call but cannot
    // select the requested operation from the real agent surface. Keep this
    // model-agnostic and deliberately place the target last.
    const selectionDecoys = Array.from({ length: 38 }, (_, index) => ({
      type: "function",
      function: {
        name: `vibestudio_unrelated_operation_${index}`,
        description: `Unrelated compatibility operation ${index}. Do not use it for the runtime probe.`,
        parameters: {
          type: "object",
          properties: { input: { type: "string" } },
          required: ["input"],
        },
      },
    }));
    const selectionTools = [...selectionDecoys, probeTool];
    const generationResponse = await this.deps.fetch(
      `http://127.0.0.1:${port}/v1/chat/completions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: model.slug,
          messages: [
            {
              role: "user",
              content: `Call vibestudio_runtime_probe with value "${assistantCallSentinel}".`,
            },
          ],
          tools: selectionTools,
          tool_choice: "required",
          temperature: 0,
        }),
      },
    );
    if (!generationResponse.ok) {
      throw new Error(
        `local model ${model.slug} tool-call probe failed with HTTP ${generationResponse.status}`,
      );
    }
    const generated = (await generationResponse.json()) as {
      choices?: Array<{
        message?: {
          tool_calls?: Array<{
            function?: {
              name?: string;
              arguments?: string | Record<string, unknown>;
            };
          }>;
        };
      }>;
    };
    const generatedCall =
      generated.choices?.[0]?.message?.tool_calls?.[0]?.function;
    let generatedArguments: unknown = generatedCall?.arguments;
    if (typeof generatedArguments === "string") {
      try {
        generatedArguments = JSON.parse(generatedArguments) as unknown;
      } catch {
        // The structured shape below rejects non-JSON arguments.
      }
    }
    if (
      generatedCall?.name !== "vibestudio_runtime_probe" ||
      !generatedArguments ||
      typeof generatedArguments !== "object" ||
      (generatedArguments as Record<string, unknown>)["value"] !==
        assistantCallSentinel
    ) {
      throw new Error(
        `local model ${model.slug} could not reliably select and produce a parsed structured tool call from the full agent tool surface`,
      );
    }

    const templateResponse = await this.deps.fetch(
      `http://127.0.0.1:${port}/apply-template`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: model.slug,
          messages: [
            { role: "user", content: "Run the runtime probe." },
            {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "runtime_probe_call",
                  type: "function",
                  function: {
                    name: "vibestudio_runtime_probe",
                    arguments: JSON.stringify({ value: assistantCallSentinel }),
                  },
                },
              ],
            },
            {
              role: "tool",
              tool_call_id: "runtime_probe_call",
              name: "vibestudio_runtime_probe",
              content: JSON.stringify({ received: true }),
            },
            { role: "user", content: "Continue." },
          ],
          tools: [probeTool],
          add_generation_prompt: true,
        }),
      },
    );
    if (!templateResponse.ok) {
      throw new Error(
        `local model ${model.slug} chat-template probe failed with HTTP ${templateResponse.status}`,
      );
    }
    const rendered = (await templateResponse.json()) as { prompt?: string };
    if (!rendered.prompt?.includes(assistantCallSentinel)) {
      throw new Error(
        `local model ${model.slug} chat template drops assistant tool calls from conversation history`,
      );
    }
    return true;
  }

  private async restart(kind: ServerKind): Promise<void> {
    await this.activate();
    if (this.roleValue === "attached") {
      await this.ensureAttachedOwnerAlive();
      if (this.roleValue === "attached") {
        const result = await this.requestOwner({
          kind: "restart",
          server: kind,
        });
        if (!("ok" in result) || result.ok !== true) {
          throw new Error(
            "local-models owner returned an invalid restart response",
          );
        }
        return;
      }
    }
    await this.restartAsOwner(kind);
  }

  private async restartAsOwner(kind: ServerKind): Promise<void> {
    if (this.roleValue !== "owner")
      throw new Error("local-models supervisor is attached");

    // A restart only re-launches a server that was already up (or mid-launch):
    // the fallback floor is lazy (design §5), so restarting a cold utility must
    // NOT force it warm — it starts on demand via ensureLoaded.
    const runtime = this.servers[kind];
    const shouldRun =
      !!runtime.process ||
      runtime.state.state === "running" ||
      runtime.state.state === "starting" ||
      runtime.state.state === "backoff";
    this.clearRestartTimer(kind);
    await this.stopProcess(kind, "SIGTERM");

    if (shouldRun) await this.startServer(kind);
    else this.setState(kind, { state: "stopped" });
  }

  private startServer(
    kind: ServerKind,
    model?: ModelRecord,
  ): Promise<RuntimeProcess | undefined> {
    const runtime = this.servers[kind];
    if (runtime.launchFlight) return runtime.launchFlight;
    const flight = (runtime.stopFlight ?? Promise.resolve()).then(() =>
      this.startProcess(kind, model),
    );
    runtime.launchFlight = flight;
    void flight.then(
      () => {
        if (runtime.launchFlight === flight) runtime.launchFlight = undefined;
      },
      () => {
        if (runtime.launchFlight === flight) runtime.launchFlight = undefined;
      },
    );
    return flight;
  }

  private async startProcess(
    kind: ServerKind,
    model?: ModelRecord,
  ): Promise<RuntimeProcess | undefined> {
    if (this.disposed || this.roleValue !== "owner") return;
    this.clearRestartTimer(kind);

    const runtime = this.servers[kind];
    if (kind === "main") this.loadedMainModels.clear();

    const launch = await this.launchSpec(kind, model);
    if (!launch || this.disposed) return;

    const token = ++this.nextProcessToken;
    const readiness = this.processReadiness(this.portFor(kind));
    this.setState(kind, { state: "starting" });

    try {
      const child = this.spawnOwned(launch.bin, launch.args, {
        env: cleanEnv(),
        onExit: (code) => {
          readiness.fail(
            new Error(
              `${kind} server exited with code ${String(code)}${this.tailLog(kind, 1)[0] ? `: ${this.tailLog(kind, 1)[0]}` : ""}`,
            ),
          );
          const flight = this.handleExit(kind, token, code);
          this.exitFlights.add(flight);
          runtime.exitFlight = flight;
          void flight.then(
            () => {
              this.exitFlights.delete(flight);
              if (runtime.exitFlight === flight) runtime.exitFlight = undefined;
            },
            () => {},
          );
        },
        onStdout: (line) => {
          this.recordLog(kind, "stdout", line);
          readiness.observe(line);
        },
        onStderr: (line) => {
          if (line.includes("EADDRINUSE")) {
            const active = this.servers[kind].process;
            if (active?.token === token) active.eaddrInUse = true;
          }
          this.recordLog(kind, "stderr", line);
          readiness.observe(line);
        },
      });
      const active: RuntimeProcess = {
        token,
        child,
        readiness,
        recipe: launch.recipe,
        expectedExit: false,
        eaddrInUse: false,
      };
      runtime.process = active;
      runtime.startedAt = this.deps.now();
      this.writeOwnerInfo(); // record the child pid for dead-owner reaping
      readiness.start();
      void child.closed.then(
        () => readiness.fail(new Error(`${kind} server closed`)),
        (error) => readiness.fail(error),
      );
      void readiness.ready.then(
        () => {
          if (this.disposed || runtime.process?.token !== token) return;
          this.setState(kind, this.runningState(kind));
        },
        () => {},
      );
      return active;
    } catch (error) {
      readiness.fail(error);
      this.readiness.delete(readiness);
      if (isEaddrInUse(error)) {
        await this.reallocatePort(kind);
        return await this.startProcess(kind);
      }
      this.recordLog(kind, "stderr", errorMessage(error));
      await this.handleFailure(kind, errorMessage(error));
      throw error;
    }
  }

  private async launchSpec(
    kind: ServerKind,
    selected?: ModelRecord,
  ): Promise<{ bin: string; args: string[]; recipe: string } | null> {
    const engines = this.deps.engines();
    if (!engines?.cpu) {
      this.setState(kind, {
        state: "error",
        message: "llama.cpp CPU engine is not installed",
        logTail: this.tailLog(kind),
      });
      return null;
    }

    if (kind === "utility") {
      const fallback = selected ?? (await this.deps.fallbackModel());
      if (!fallback) {
        this.setState(kind, {
          state: "error",
          message: "fallback model is not downloaded",
          logTail: this.tailLog(kind),
        });
        return null;
      }
      const recipe = this.recipeFor("utility", fallback);
      return {
        bin: recipe.bin,
        recipe: JSON.stringify(recipe),
        args: [
          "-m",
          fallback.file,
          "--port",
          String(this.portFor("utility")),
          "--host",
          "127.0.0.1",
          "--api-key-file",
          this.paths.authKey,
          ...modelRuntimeArgs(recipe),
          "--jinja",
          // Single sequence, not `-np 2`: llama.cpp splits the KV cache evenly
          // across parallel slots. The fallback needs its full advertised 128K
          // window for the agent prompt, tool schemas, history, and response.
          // The utility server is a lazy, single-purpose floor (design §5), so
          // full context per turn beats concurrency; simultaneous fallbacks
          // queue, which is the right trade for a rarely-hit floor.
          "-np",
          "1",
        ],
      };
    }

    const model =
      selected ??
      (this.mainModelSlug
        ? await this.deps.libraryModel(this.mainModelSlug)
        : (await this.deps.libraryModels()).find(
            (record) => record.slug !== FALLBACK_MODEL.slug,
          ));
    if (!model) return null;
    const recipe = this.recipeFor("main", model);
    // Router discovery: --models-dir does NOT scan our nested
    // publisher/repo/file.gguf layout (verified live: "Available models (0)"),
    // and file-derived names wouldn't match our slugs. A generated preset INI
    // solves both — sections are slugs, entries point at the exact GGUF
    // (design §4.4; verified against current llama.cpp releases).
    const presetPath = await this.writeRouterPreset(model);
    if (!presetPath) {
      this.setState(kind, {
        state: "error",
        message: "no library models to serve",
        logTail: this.tailLog(kind),
      });
      return null;
    }
    return {
      bin: recipe.bin,
      recipe: recipe.bin,
      args: [
        "--models-preset",
        presetPath,
        "--models-max",
        "1",
        "--port",
        String(this.portFor("main")),
        "--host",
        "127.0.0.1",
        "--api-key-file",
        this.paths.authKey,
        "--jinja",
      ],
    };
  }

  /** Generate the router preset INI from the library (fallback excluded — it
   *  has its own dedicated server). Returns null when the library is empty. */
  private async writeRouterPreset(
    selected?: ModelRecord,
  ): Promise<string | null> {
    const records = (await this.deps.libraryModels())
      .filter((record) => record.slug !== FALLBACK_MODEL.slug)
      .map((record) => (selected?.slug === record.slug ? selected : record));
    if (records.length === 0) {
      this.routerCatalogModels.clear();
      return null;
    }
    this.routerCatalogModels = new Map(
      records.map((record) => [
        record.slug,
        JSON.stringify(this.recipeFor("main", record)),
      ]),
    );
    const sections = records.map((record) => {
      const recipe = this.recipeFor("main", record);
      const lines = [
        `[${record.slug}]`,
        `model = ${record.file}`,
        `ctx-size = ${recipe.contextLength}`,
      ];
      if (recipe.gpuLayers !== null) {
        lines.push(`n-gpu-layers = ${recipe.gpuLayers}`);
      }
      return lines.join("\n");
    });
    const presetPath = join(this.rootDir, "router-preset.ini");
    writeFileSync(presetPath, `${sections.join("\n\n")}\n`, { mode: 0o600 });
    return presetPath;
  }

  private async handleExit(
    kind: ServerKind,
    token: number,
    code: number | null,
  ): Promise<void> {
    const runtime = this.servers[kind];
    const active = runtime.process;
    if (!active || active.token !== token) return;

    runtime.process = null;
    runtime.startedAt = null;
    if (kind === "main") this.loadedMainModels.clear();

    if (active.expectedExit || this.disposed) {
      this.setState(kind, { state: "stopped" });
      return;
    }

    if (active.eaddrInUse) {
      this.recordLog(
        kind,
        "stderr",
        `${kind} server port ${this.portFor(kind)} is in use; reallocating`,
      );
      await this.reallocatePort(kind);
      await this.startServer(kind);
      return;
    }

    await this.handleFailure(
      kind,
      `${kind} server exited with code ${code ?? "null"}`,
    );
  }

  private async handleFailure(
    kind: ServerKind,
    message: string,
  ): Promise<void> {
    if (this.disposed) return;
    const runtime = this.servers[kind];
    const now = this.deps.now();
    runtime.failureTimes = runtime.failureTimes.filter(
      (time) => now - time <= FAILURE_WINDOW_MS,
    );
    runtime.failureTimes.push(now);

    const engines = this.deps.engines();
    if (kind === "utility" && !this.utilityCpuFallback && engines?.gpu) {
      this.utilityCpuFallback = true;
      this.recordLog(
        "utility",
        "stderr",
        `accelerated utility server failed; degrading to CPU: ${message}`,
      );
    }

    if (kind === "main" && runtime.failureTimes.length >= MAIN_FAILURE_LIMIT) {
      this.setState("main", {
        state: "error",
        message,
        logTail: this.tailLog("main"),
      });
      return;
    }

    const attempt = runtime.failureTimes.length;
    const maxBackoff =
      kind === "utility" ? UTILITY_MAX_BACKOFF_MS : MAIN_MAX_BACKOFF_MS;
    const nextRetryMs = Math.min(
      maxBackoff,
      1000 * 2 ** Math.max(0, attempt - 1),
    );
    this.setState(kind, { state: "backoff", attempt, nextRetryMs });
    runtime.restartTimer = this.setTimer(() => {
      runtime.restartTimer = null;
      void this.startServer(kind);
    }, nextRetryMs);
  }

  private async reallocatePort(kind: ServerKind): Promise<void> {
    const oldPort = this.portFor(kind);
    const nextPort = await allocatePort(oldPort);
    if (!this.ports) throw new Error("ports are not initialized");
    this.ports = { ...this.ports, [kind]: nextPort };
    this.writeConfig({
      utilityPort: this.ports.utility,
      mainPort: this.ports.main,
      adminPort: this.adminPort ?? undefined,
    });
    this.writeOwnerInfo();
  }

  private scheduleIdleUnload(): void {
    if (this.idleTimer) this.clearTimeoutFn(this.idleTimer);
    this.idleTimer = this.setTimer(() => {
      this.idleTimer = null;
      void this.checkIdleUnload();
    }, IDLE_UNLOAD_MS);
  }

  private markUsed(slug: string): void {
    this.lastUsed.set(slug, this.deps.now());
    this.scheduleIdleUnload();
  }

  private async checkIdleUnload(): Promise<void> {
    if (this.roleValue !== "owner" || this.lastUsed.size === 0) return;
    const now = this.deps.now();
    let nextCheckMs = Number.POSITIVE_INFINITY;

    const fallbackUsedAt = this.lastUsed.get(FALLBACK_MODEL.slug);
    if (fallbackUsedAt !== undefined) {
      const fallbackIdleFor = now - fallbackUsedAt;
      if (fallbackIdleFor >= IDLE_UNLOAD_MS) {
        this.lastUsed.delete(FALLBACK_MODEL.slug);
        await this.stopIdleServer("utility");
      } else {
        nextCheckMs = Math.min(nextCheckMs, IDLE_UNLOAD_MS - fallbackIdleFor);
      }
    }

    const mainUses = Array.from(this.lastUsed.entries()).filter(
      ([slug]) => slug !== FALLBACK_MODEL.slug,
    );
    if (mainUses.length > 0) {
      const newestMainUse = Math.max(...mainUses.map(([, usedAt]) => usedAt));
      const mainIdleFor = now - newestMainUse;
      if (mainIdleFor >= IDLE_UNLOAD_MS) {
        for (const [slug] of mainUses) this.lastUsed.delete(slug);
        await this.stopIdleServer("main");
      } else {
        nextCheckMs = Math.min(nextCheckMs, IDLE_UNLOAD_MS - mainIdleFor);
      }
    }

    if (Number.isFinite(nextCheckMs)) {
      this.idleTimer = this.setTimer(() => {
        this.idleTimer = null;
        void this.checkIdleUnload();
      }, nextCheckMs);
    }
  }

  private async stopIdleServer(kind: ServerKind): Promise<void> {
    this.clearRestartTimer(kind);
    await this.stopProcess(kind, "SIGTERM");
    if (kind === "main") this.loadedMainModels.clear();
    this.setState(kind, { state: "stopped" });
  }

  private stopProcess(kind: ServerKind, signal: string): Promise<void> {
    const runtime = this.servers[kind];
    if (runtime.stopFlight) return runtime.stopFlight;
    const flight = this.finishStop(kind, signal);
    runtime.stopFlight = flight;
    void flight.then(
      () => {
        if (runtime.stopFlight === flight) runtime.stopFlight = undefined;
      },
      () => {
        if (runtime.stopFlight === flight) runtime.stopFlight = undefined;
      },
    );
    return flight;
  }

  private async finishStop(kind: ServerKind, signal: string): Promise<void> {
    const runtime = this.servers[kind];
    const active = runtime.process;
    if (!active) return;
    // A refusal retains this exact process; no replacement can take its port.
    active.expectedExit = true;
    try {
      active.child.kill(signal);
    } catch (error) {
      active.expectedExit = false;
      throw error;
    }
    active.readiness.fail(new Error(`${kind} server was explicitly stopped`));
    await active.child.closed;
    await active.readiness.join();
    if (runtime.exitFlight) await runtime.exitFlight;
    if (runtime.process === active) runtime.process = null;
    runtime.startedAt = null;
    if (kind === "main") {
      this.loadedMainModels.clear();
      this.loadedRecipes.clear();
    }
  }

  private clearRestartTimer(kind: ServerKind): void {
    const timer = this.servers[kind].restartTimer;
    if (!timer) return;
    this.clearTimeoutFn(timer);
    this.servers[kind].restartTimer = null;
  }

  private setTimer(callback: () => void, delayMs: number): TimerHandle {
    const handle = this.setTimeoutFn(callback, delayMs);
    maybeUnref(handle);
    return handle;
  }

  private setState(kind: ServerKind, state: ServerState): void {
    this.servers[kind].state = state;
    this.deps.emit({ kind: "server.state", server: kind, state });
  }

  private portFor(kind: ServerKind): number {
    if (!this.ports) throw new Error("ports are not initialized");
    return this.ports[kind];
  }

  private recordLog(kind: ServerKind, event: ServerEvent, line: string): void {
    const target = this.logs[kind];
    const lines = line.split(/\r?\n/).filter((entry) => entry.length > 0);
    for (const entry of lines.length > 0 ? lines : [line]) {
      target.push(event === "stderr" ? `[stderr] ${entry}` : entry);
      if (target.length > RING_LINES)
        target.splice(0, target.length - RING_LINES);
    }
  }

  private tailLog(kind: ServerKind, lines = RING_LINES): string[] {
    const bounded = Math.max(0, Math.min(RING_LINES, Math.floor(lines)));
    if (bounded === 0) return [];
    return this.logs[kind].slice(-bounded);
  }

  private dispose(reason: unknown = this.disposalReason): Promise<void> {
    if (this.disposalFlight) return this.disposalFlight;
    this.disposed = true;
    this.disposalReason = reason;
    for (const readiness of this.readiness) readiness.fail(reason);
    const flight = this.finishDisposal();
    this.disposalFlight = flight;
    void flight.catch(() => {
      if (this.disposalFlight === flight) this.disposalFlight = undefined;
    });
    return flight;
  }

  private async finishDisposal(): Promise<void> {
    const failures: unknown[] = [];
    if (this.activationFlight) {
      try {
        await this.activationFlight;
      } catch (error) {
        failures.push(error);
      }
    }
    if (this.idleTimer) {
      this.clearTimeoutFn(this.idleTimer);
      this.idleTimer = null;
    }
    for (const kind of SERVER_KINDS) {
      this.clearRestartTimer(kind);
      const active = this.servers[kind].process;
      if (active) active.expectedExit = true;
    }
    const joins: Promise<void>[] = [];
    let failedToStop = false;
    for (const child of this.ownedProcesses) {
      try {
        child.kill("SIGTERM");
        joins.push(child.closed);
      } catch (error) {
        failedToStop = true;
        failures.push(error);
      }
    }
    for (const result of await Promise.allSettled(joins))
      if (result.status === "rejected") failures.push(result.reason);
    for (const result of await Promise.allSettled(
      [...this.readiness].map((readiness) => readiness.join()),
    ))
      if (result.status === "rejected") failures.push(result.reason);
    this.readiness.clear();
    // Child close occurs after its exit callback. Join that callback's resource work
    // before withdrawing the lease, including port changes admitted before sealing.
    for (const result of await Promise.allSettled([...this.exitFlights]))
      if (result.status === "rejected") failures.push(result.reason);
    // A failed stop still owns a live child. Keep the lease for an explicit disposal retry.
    if (!failedToStop) {
      for (const kind of SERVER_KINDS)
        this.setState(kind, { state: "stopped" });
      if (this.roleValue === "owner") {
        try {
          await this.adminListener?.close();
          this.adminListener = null;
          if (this.lockFd !== null) {
            closeSync(this.lockFd);
            this.lockFd = null;
          }
          unlinkIfExists(this.paths.owner);
          unlinkIfExists(this.paths.lock);
        } catch (error) {
          failures.push(error);
        }
      }
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1)
      throw new AggregateError(
        failures,
        "Local-models disposal failed to join owned resources",
        { cause: failures[0] },
      );
  }
}

function normalizeSlug(slug: string): string {
  return slug.startsWith("local:") ? slug.slice("local:".length) : slug;
}

function baseUrl(port: number): string {
  return `http://127.0.0.1:${port}/v1`;
}

function cleanEnv(
  source: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    if (
      key === "LD_PRELOAD" ||
      key === "NODE_OPTIONS" ||
      key.startsWith("DYLD_")
    )
      continue;
    env[key] = value;
  }
  return env;
}

async function allocatePort(exclude?: number | number[]): Promise<number> {
  const excluded = new Set(
    Array.isArray(exclude) ? exclude : exclude === undefined ? [] : [exclude],
  );
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const port = await askOsForPort().catch(() =>
      fallbackPort(excluded, attempt),
    );
    if (!excluded.has(port)) return port;
  }
  return askOsForPort().catch(() => fallbackPort(excluded, 20));
}

function askOsForPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo | null;
      const port = address?.port;
      server.close((error) => {
        if (error) reject(error);
        else if (typeof port === "number") resolve(port);
        else reject(new Error("failed to allocate a local port"));
      });
    });
  });
}

function validPort(port: unknown): port is number {
  return (
    typeof port === "number" &&
    Number.isInteger(port) &&
    port > 0 &&
    port <= 65535
  );
}

function fallbackPort(excluded: ReadonlySet<number>, attempt: number): number {
  const min = 20_000;
  const span = 45_536;
  let port = min + ((randomBytes(2).readUInt16BE(0) + attempt) % span);
  while (excluded.has(port)) port = port >= 65_535 ? min : port + 1;
  return port;
}

const ADMIN_BODY_LIMIT_BYTES = 16 * 1024;

const HTTP_ADMIN_TRANSPORT: SupervisorAdminTransport = {
  listen(port, apiKey, handler) {
    return new Promise((resolve, reject) => {
      const server = createHttpServer((request, response) => {
        void handleAdminHttpRequest(request, apiKey, handler)
          .then(({ status, body }) => {
            response.writeHead(status, { "content-type": "application/json" });
            response.end(JSON.stringify(body));
          })
          .catch((error: unknown) => {
            response.writeHead(500, { "content-type": "application/json" });
            response.end(JSON.stringify({ error: errorMessage(error) }));
          });
      });
      const onError = (error: Error) => reject(error);
      server.once("error", onError);
      server.listen(port, "127.0.0.1", () => {
        server.off("error", onError);
        server.unref();
        resolve({
          close: () =>
            new Promise<void>((closeResolve, closeReject) => {
              server.close((error) =>
                error ? closeReject(error) : closeResolve(),
              );
            }),
        });
      });
    });
  },
  async request(port, apiKey, command) {
    const response = await fetch(`http://127.0.0.1:${port}/admin`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(command),
    });
    const body = (await response.json().catch(() => null)) as unknown;
    if (!response.ok) {
      const detail =
        isRecord(body) && typeof body["error"] === "string"
          ? `: ${body["error"]}`
          : "";
      throw new Error(
        `local-models owner request failed with HTTP ${response.status}${detail}`,
      );
    }
    if (!isAdminResult(body))
      throw new Error("local-models owner returned malformed JSON");
    return body;
  },
};

async function handleAdminHttpRequest(
  request: IncomingMessage,
  apiKey: string,
  handler: (command: SupervisorAdminCommand) => Promise<SupervisorAdminResult>,
): Promise<{
  status: number;
  body: SupervisorAdminResult | { error: string };
}> {
  if (request.method !== "POST" || request.url !== "/admin") {
    return { status: 404, body: { error: "not found" } };
  }
  if (request.headers.authorization !== `Bearer ${apiKey}`) {
    return { status: 401, body: { error: "unauthorized" } };
  }
  try {
    const command = parseAdminCommand(
      JSON.parse(await readBoundedBody(request)) as unknown,
    );
    return { status: 200, body: await handler(command) };
  } catch (error) {
    return { status: 400, body: { error: errorMessage(error) } };
  }
}

async function readBoundedBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > ADMIN_BODY_LIMIT_BYTES)
      throw new Error("admin request body is too large");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function parseAdminCommand(value: unknown): SupervisorAdminCommand {
  if (!isRecord(value) || typeof value["kind"] !== "string") {
    throw new Error("invalid admin command");
  }
  if (value["kind"] === "status" && Object.keys(value).length === 1)
    return { kind: "status" };
  if (
    value["kind"] === "ensure-loaded" &&
    typeof value["slug"] === "string" &&
    value["slug"].length > 0
  ) {
    return { kind: "ensure-loaded", slug: value["slug"] };
  }
  if (
    value["kind"] === "restart" &&
    (value["server"] === "utility" || value["server"] === "main")
  ) {
    return { kind: "restart", server: value["server"] };
  }
  throw new Error("invalid admin command");
}

function isAdminResult(value: unknown): value is SupervisorAdminResult {
  return (
    isRecord(value) &&
    (typeof value["baseUrl"] === "string" ||
      value["ok"] === true ||
      isServerStates(value["servers"]))
  );
}

function isServerStates(
  value: unknown,
): value is Record<ServerKind, ServerState> {
  return (
    isRecord(value) &&
    Object.keys(value).length === 2 &&
    isServerState(value["utility"]) &&
    isServerState(value["main"])
  );
}

function isServerState(value: unknown): value is ServerState {
  if (!isRecord(value)) return false;
  switch (value["state"]) {
    case "stopped":
    case "starting":
      return Object.keys(value).length === 1;
    case "running":
      return (
        validPort(value["port"]) &&
        Array.isArray(value["loadedModels"]) &&
        value["loadedModels"].every((model) => typeof model === "string") &&
        typeof value["uptimeMs"] === "number" &&
        Number.isFinite(value["uptimeMs"]) &&
        value["uptimeMs"] >= 0
      );
    case "backoff":
      return (
        typeof value["attempt"] === "number" &&
        Number.isInteger(value["attempt"]) &&
        value["attempt"] > 0 &&
        typeof value["nextRetryMs"] === "number" &&
        Number.isFinite(value["nextRetryMs"]) &&
        value["nextRetryMs"] >= 0
      );
    case "error":
      return (
        typeof value["message"] === "string" &&
        Array.isArray(value["logTail"]) &&
        value["logTail"].every((line) => typeof line === "string")
      );
    default:
      return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJsonFile<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

function unlinkIfExists(path: string): void {
  try {
    unlinkSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function readBootId(): string {
  try {
    return readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
  } catch {
    return randomUUID();
  }
}

function maybeUnref(handle: TimerHandle): void {
  if (typeof handle !== "object" || handle === null || !("unref" in handle))
    return;
  const maybeHandle = handle as { unref?: () => void };
  maybeHandle.unref?.();
}

function isEaddrInUse(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  if (code === "EADDRINUSE") return true;
  return errorMessage(error).includes("EADDRINUSE");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
