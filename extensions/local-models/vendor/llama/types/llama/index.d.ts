/**
 * @natlang/llama: natlang's managed llama.cpp machinery with its host dependencies injected (llama/host.ts) — runtime
 * discovery, install and fork build; stock model download with SHA-256 verification; slot sizing; the warm prompt-prefix
 * cache; shared servers; and the lifecycle of one server (`createLlamaServer`). The natlang CLI binds Node's host
 * (`nodeLlamaHost`); a host with its own supervisor passes its spawn, directories, fetch and log, and either lets the
 * package launch through them, supplies a `launch` that starts the server itself, or `attach`es a server it already runs.
 * Published as `@natlang/node/llama`.
 */
export type { LlamaHost, LlamaProcess, LlamaProcesses, LlamaRunResult, LlamaDirectories, LlamaLog } from './host.js';
export { nodeLlamaHost, nodeLlamaDirectories, nodeLlamaProcesses, defaultNatlangRuntimeDirectory } from './node.js';
export { LLAMA_RUNTIME_RELEASE, LLAMA_FORK_SOURCE, isCompatibleLlamaVersion, inspectLlamaServer, discoverLlamaRuntime, installManagedLlamaRuntime, buildForkLlamaRuntime, describeLlamaRuntime } from './runtime.js';
export type { LlamaRuntimeArtifact, LlamaRuntimeRelease, LlamaServerInspection, LlamaRuntimeDiscovery } from './runtime.js';
export { DEFAULT_LOCAL_MODEL, STOCK_MODELS, stockModel } from '../model-catalog.js';
export type { LocalModelRelease } from '../model-catalog.js';
export { stockModelPath, stockModelDownload, ensureStockModel, ensureModel, localModelPrerequisites, localSlotPlan, managedModelSha256, templatePath, runtimeLabel, warmTag } from './models.js';
export { planServerSlots, DEFAULT_KV_BYTES_PER_TOKEN, DEFAULT_MEMORY_FRACTION, DEFAULT_MAX_SLOTS, DEFAULT_KV_BUDGET_CAP_BYTES } from './slots.js';
export type { SlotPlan, LocalServerSettings } from './slots.js';
export { openingOf, sharedPrefix, warmOpening, pruneWarmStates } from './warm.js';
export type { Opening, WarmPrefix } from './warm.js';
export { sharedServerPath, publishSharedServer, withdrawSharedServer, readSharedServer, findSharedServer } from './shared.js';
export type { SharedServer } from './shared.js';
export { createLlamaServer, spawnLauncher, supportsNativeStates } from './server.js';
export type { LlamaServer, LlamaServerOptions, LlamaServerStatus, LlamaLaunch, LlamaLaunched, LlamaLauncher, LlamaAttachment } from './server.js';
