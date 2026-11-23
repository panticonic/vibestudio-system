/**
 * One managed llama.cpp server: find or install its runtime, resolve its model and chat template, size its slots, start
 * it (shared by every natlang process that needs the same model, settings, adapters and native states, llama/shared.ts;
 * or one the host supervises itself), keep the warm prompt
 * openings (llama/warm.ts) saved and restored in its slots, and stop it. Mechanism only; what to ask the model, how
 * requests are queued and how replies are scored belong to the caller, which reads `start()`'s endpoint.
 *
 * Who runs the process is the host's choice (llama/host.ts):
 * - by default the package spawns llama-server through `host.processes` and waits for its health check (`spawnLauncher`);
 * - a host with its own supervisor passes `launch`, which receives the exact command, arguments and endpoint and returns
 *   once the server answers (the package still plans slots and warm states around it);
 * - a host that already runs a server passes `attach` and nothing is started.
 */
import { type LocalModelRelease } from '../model-catalog.js';
import type { ModelTurnRequest } from '../contracts.js';
import type { WarmPrefix } from '../package/warm.js';
import type { LlamaHost } from './host.js';
import { type LlamaRuntimeDiscovery, type LlamaServerInspection } from './runtime.js';
import type { LocalServerSettings, SlotPlan } from './slots.js';
/** A llama-server invocation the package has decided on. */
export type LlamaLaunch = {
    command: string;
    args: readonly string[];
    port: number;
    endpoint: string;
};
/** A launched server: stop it. Resolves `launch` only once the server answers its health check. */
export type LlamaLaunched = {
    stop(): Promise<void>;
};
/** Start a llama-server. `signal` aborts when the server is closed while starting; honor it by stopping what was started. */
export type LlamaLauncher = (launch: LlamaLaunch, signal: AbortSignal) => Promise<LlamaLaunched>;
/** A server the host already runs, to plan around without starting it. It is serving: attach only once its load has completed. */
export type LlamaAttachment = {
    endpoint: string;
    slots: number;
    contextPerSlot: number;
    /** The GGUF it serves and its llama-server build as `runtimeLabel` writes it: a warm state restores only into the same pair. */
    modelSha256: string;
    runtime: string | null;
    /** It was started with `--slot-save-path` set to `host.directories.warmPrefixes`, so warm openings can be saved and restored. */
    warm?: boolean;
};
export type LlamaServerOptions = {
    release?: LocalModelRelease;
    local?: LocalServerSettings;
    /** Tuned weight adapters (GGUF LoRA exports) to load at start, keyed by artifact ID; see `LlamaServer.loraIndex`. */
    loraAdapters?: () => readonly {
        readonly id: string;
        readonly path: string;
    }[];
    /** Native state span files (tuned soft states) to load with `--native-state` (the llama.cpp fork). */
    nativeStates?: () => readonly {
        readonly id: string;
        readonly path: string;
    }[];
    /** Called when no compatible runtime is found; may install one and return it (a host's consent decides). */
    ensureRuntime?: (discovery: LlamaRuntimeDiscovery) => Promise<LlamaServerInspection | null>;
    /** Called when the stock model file is not downloaded; true lets the server download it (the host may have done so
     * already), false declines. Without it a missing model is an error: a library never downloads gigabytes unasked. */
    ensureModel?: (release: LocalModelRelease) => Promise<boolean>;
    /** Sent with the package's own requests to the server (health, slots, warm states). */
    headers?: Record<string, string>;
    /** Use (or start) the server shared by natlang processes on this machine that need the same model, settings, adapters
     * and native states (llama/shared.ts; default true, NATLANG_SHARED_SERVER=off turns it off). */
    useSharedServer?: boolean;
    launch?: LlamaLauncher;
    attach?: LlamaAttachment;
};
export type LlamaServerStatus = {
    endpoint: string | null;
    executable: string | null;
    running: boolean;
    /** It is a server another process keeps loaded. */
    shared: boolean;
    /** The llama.cpp build number and its `runtimeLabel` (`b<build>g<commit>`). */
    runtimeBuild: number | null;
    runtime: string | null;
    /** The prompt openings this server warmed (prefilled and saved, or restored). */
    warm: WarmPrefix[];
};
export type LlamaServer = {
    /** Start the server if it is not running (once, however many callers) and return its endpoint. Throws when it is closed. */
    start(): Promise<string>;
    /**
     * The gate of one generated turn: start the server, restore or prefill the request's warm opening in its slots, and
     * count the turn as in flight (a warm state needs every slot idle). Call the returned `release` when the turn ends.
     */
    admit(request: ModelTurnRequest, signal?: AbortSignal): Promise<{
        endpoint: string;
        release(): void;
    }>;
    /** The slot sizing once the server has started (null before). */
    plan(): SlotPlan | null;
    /** Adapter artifact ID -> llama-server adapter index, for the adapters loaded at the last start. */
    readonly loraIndex: ReadonlyMap<string, number>;
    /** The native state IDs loaded at the last start. */
    readonly nativeStatesLoaded: ReadonlySet<string>;
    status(): LlamaServerStatus;
    close(): Promise<void>;
};
/** Whether a llama-server binary imports native state spans exactly (`--native-state`, the llama.cpp fork). */
export declare const supportsNativeStates: (host: LlamaHost, executable: string) => boolean;
/**
 * The default launcher: spawn llama-server through the host and wait for `/health`. The server stops with the process
 * (SIGINT and SIGTERM stop it first, and the signal is raised again only when nothing else handles it, so a host with a
 * handler of its own, such as `natlang dashboard`, closes first), and a server that exits or does not answer within
 * `NATLANG_MODEL_START_TIMEOUT_MS` (default 120 s) fails the start with its error output.
 */
export declare function spawnLauncher(host: LlamaHost): LlamaLauncher;
export declare function createLlamaServer(host: LlamaHost, options?: LlamaServerOptions): LlamaServer;
/** A release's chat-template keyword arguments (its `request.chat_template_kwargs`), or null when it declares none. */
export declare function templateKwargs(release: {
    readonly request?: Readonly<Record<string, unknown>>;
}): Record<string, unknown> | null;
