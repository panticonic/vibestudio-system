/**
 * What natlang's llama.cpp fork adds to serving a model, over the servers this extension supervises: the warm prompt
 * openings of `@natlang/llama` (vendor/) and the fork's decision readout (`POST /v1/natlang/score`). The supervisor
 * runs every server; this module only plans and requests around a loaded model, through `createLlamaServer`'s `attach`
 * mode, so there is one lifecycle and one set of slots.
 */
import { join } from "node:path";
import {
  createLlamaServer,
  openingOf,
  type LlamaHost,
  type LlamaServer,
  type WarmPrefix,
} from "./vendor/llama/natlang-llama.js";
import type { ModelRecord } from "@workspace/model-catalog/localModels";
import { ROOT_LAYOUT } from "./constants.js";
import { stockSlotPlan } from "./runtime-profiles.js";
import type { LoadedModel } from "./supervisor.js";

/** The request fields a warm opening is keyed by: its system prompt and tools. */
export interface OpeningRequest {
  messages: readonly unknown[];
  tools?: readonly unknown[];
}

export interface ScoreItem {
  messages: readonly unknown[];
  continuations: readonly string[];
  tools?: readonly unknown[];
}

export type ScoreResult =
  | { log_probs: number[]; tokens: number[]; native_state_imports?: unknown[] }
  | { error: string };

export interface NatlangServingDeps {
  rootDir: string;
  log(msg: string, data?: unknown): void;
  /** Network access for loopback requests, without credentials. */
  fetch: typeof fetch;
  apiKey(): Promise<string>;
  /** Loads the model if it is not loaded and says where and as which instance it is served. */
  load(slug: string): Promise<LoadedModel>;
  record(slug: string): Promise<ModelRecord | null>;
  /** The llama.cpp release the supervised engine is: a warm state is restored only into the same build. */
  runtime: string;
}

export function createNatlangServing(deps: NatlangServingDeps): {
  warmOpening(slug: string, request: OpeningRequest, signal?: AbortSignal): Promise<WarmPrefix | null>;
  scoreContinuations(slug: string, items: readonly ScoreItem[], signal?: AbortSignal): Promise<ScoreResult[]>;
  close(): Promise<void>;
} {
  /** One planner per served instance of a model: the openings it warmed are gone when its server process is. */
  const planners = new Map<string, { instance: string; server: LlamaServer }>();

  async function plannerFor(slug: string, loaded: LoadedModel, record: ModelRecord): Promise<LlamaServer> {
    const existing = planners.get(slug);
    if (existing?.instance === loaded.instance) return existing.server;
    await existing?.server.close();
    const plan = stockSlotPlan(record);
    const key = await deps.apiKey();
    const host = supervisedHost(deps, slug);
    const server = createLlamaServer(host, {
      headers: { authorization: `Bearer ${key}` },
      attach: {
        endpoint: loaded.baseUrl.replace(/\/v1$/u, ""),
        slots: plan?.slots ?? 1,
        contextPerSlot: plan?.contextPerSlot ?? loaded.runtimeConfig.contextLength ?? record.trainedContextLength,
        modelSha256: record.sha256,
        runtime: deps.runtime,
        warm: true,
      },
    });
    planners.set(slug, { instance: loaded.instance, server });
    return server;
  }

  async function served(slug: string): Promise<{ loaded: LoadedModel; record: ModelRecord }> {
    const record = await deps.record(slug);
    if (!record) throw new Error(`local model not found: ${slug}`);
    return { loaded: await deps.load(slug), record };
  }

  return {
    async warmOpening(slug, request, signal) {
      const opening = openingOf(request as Parameters<typeof openingOf>[0]);
      if (!opening) return null;
      const { loaded, record } = await served(slug);
      const server = await plannerFor(slug, loaded, record);
      // The turn itself is the caller's: admission only warms the opening, so nothing stays in flight.
      (await server.admit(request as never, signal)).release();
      return server.status().warm.find((state) => state.sha256 === opening.key) ?? null;
    },

    async scoreContinuations(slug, items, signal) {
      const { loaded } = await served(slug);
      const response = await deps.fetch(`${loaded.baseUrl.replace(/\/v1$/u, "")}/v1/natlang/score`, {
        method: "POST",
        ...(signal ? { signal } : {}),
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${await deps.apiKey()}`,
        },
        body: JSON.stringify({ model: slug, items }),
      });
      if (!response.ok) {
        throw new Error(
          `local model ${slug} scoring failed with HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`,
        );
      }
      const body = (await response.json()) as { results?: ScoreResult[] };
      if (!Array.isArray(body.results) || body.results.length !== items.length) {
        throw new Error(`local model ${slug} scoring returned ${JSON.stringify(body).slice(0, 300)}`);
      }
      return body.results;
    },

    async close() {
      const closing = [...planners.values()].map(({ server }) => server.close());
      planners.clear();
      await Promise.all(closing);
    },
  };
}

/**
 * The host `@natlang/llama` asks for, over a server this extension supervises: it starts no processes, and the
 * router that serves several models takes the model a request is for from its body (`model`) or, for a read, its query.
 */
function supervisedHost(deps: NatlangServingDeps, slug: string): LlamaHost {
  const unsupervised = (): never => {
    throw new Error("local-models supervises the llama.cpp servers; the package starts none");
  };
  return {
    environment: {},
    directories: {
      runtime: join(deps.rootDir, "natlang-runtime"),
      models: join(deps.rootDir, ROOT_LAYOUT.modelsDir),
      modelHashes: join(deps.rootDir, "natlang-model-hashes"),
      warmPrefixes: join(deps.rootDir, ROOT_LAYOUT.warmPrefixesDir),
      state: join(deps.rootDir, "natlang-state"),
      checkoutModels: null,
      templates: [],
    },
    processes: {
      spawn: unsupervised,
      run: unsupervised,
      freePort: unsupervised,
    },
    fetch: routedFetch(deps.fetch, slug),
    log: { write: (text) => deps.log(text.trim()) },
  };
}

function routedFetch(fetchFn: typeof fetch, slug: string): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (init?.method === "POST" && typeof init.body === "string") {
      const body = JSON.parse(init.body) as Record<string, unknown>;
      return fetchFn(url, { ...init, body: JSON.stringify({ model: slug, ...body }) });
    }
    url.searchParams.set("model", slug);
    return fetchFn(url, init);
  }) as typeof fetch;
}
