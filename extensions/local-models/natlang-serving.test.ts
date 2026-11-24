import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ModelRecord } from "@workspace/model-catalog/localModels";
import { LFM3_MODEL, ROOT_LAYOUT } from "./constants.js";
import { createNatlangServing, type ScoreItem, type ScoreResult } from "./natlang-serving.js";
import type { LoadedModel } from "./supervisor.js";

const SLUG = LFM3_MODEL.slug;
const OPENING = `You are the executor of a natlang program. ${"Rules apply. ".repeat(40)}`;

let rootDir: string;
beforeEach(async () => {
  rootDir = await mkdtemp(join(tmpdir(), "local-models-serving-"));
});
afterEach(async () => {
  await rm(rootDir, { recursive: true, force: true });
});

interface Seen {
  method: string;
  path: string;
  authorization: string | null;
  signal: AbortSignal | null;
  body: Record<string, unknown> | null;
}

/** A router serving one model: it answers a request only if it is for that model, as llama-server's router does. */
function fakeRouter(slotCount: number, scoreResult: ScoreResult = { log_probs: [-0.5, -2], tokens: [1, 1], prompt_tokens: 412 }) {
  const seen: Seen[] = [];
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    const headers = new Headers(init?.headers);
    seen.push({
      method: init?.method ?? "GET",
      path: url.pathname + url.search,
      authorization: headers.get("authorization"),
      signal: init?.signal ?? null,
      body,
    });
    const routedTo = body?.["model"] ?? url.searchParams.get("model");
    if (routedTo !== SLUG) {
      return Response.json({ error: { message: "model name is missing from the request" } }, { status: 400 });
    }
    if (url.pathname === "/slots" && !init?.method) {
      return Response.json(Array.from({ length: slotCount }, (_, id) => ({ id, is_processing: false })));
    }
    if (url.pathname === "/apply-template") {
      const messages = body?.["messages"] as Array<{ role: string; content: string }>;
      return Response.json({
        prompt: messages.map((m) => `<|im_start|>${m.role}\n${m.content}<|im_end|>\n`).join("") + "<|im_start|>assistant\n",
      });
    }
    if (url.pathname === "/tokenize") {
      return Response.json({ tokens: Array.from({ length: 321 }, (_, index) => index) });
    }
    if (url.pathname === "/completion") return Response.json({ timings: { prompt_n: 321 } });
    if (url.pathname.startsWith("/slots/") && url.searchParams.get("action") === "save") {
      await writeFile(join(rootDir, ROOT_LAYOUT.warmPrefixesDir, String(body?.["filename"])), "state");
      return Response.json({ n_saved: 321 });
    }
    if (url.pathname.startsWith("/slots/")) return Response.json({});
    if (url.pathname === "/v1/natlang/score") {
      const items = body?.["items"] as unknown[];
      return Response.json({ results: items.map(() => scoreResult) });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  return { seen, fetchFn };
}

function serving(fetchFn: typeof fetch, instance: () => string) {
  const record = {
    slug: SLUG,
    sha256: LFM3_MODEL.quants.Q8_0.sha256,
    sizeBytes: LFM3_MODEL.quants.Q8_0.downloadSizeBytes,
    trainedContextLength: 262_144,
    config: { contextLength: null, gpuLayers: null },
  } as unknown as ModelRecord;
  return createNatlangServing({
    rootDir,
    log: () => undefined,
    fetch: fetchFn,
    apiKey: async () => "key",
    load: async (): Promise<LoadedModel> => ({
      baseUrl: "http://127.0.0.1:9/v1",
      runtimeConfig: { contextLength: null, gpuLayers: null },
      instance: instance(),
    }),
    record: async () => record,
    runtime: "natlang-b1",
  });
}

const request = { messages: [{ role: "system", content: OPENING }, { role: "user", content: "go" }] };

describe("natlang serving", () => {
  it("prefills a prompt opening once, restores it into every slot, and routes every request to the model", async () => {
    const router = fakeRouter(3);
    const api = serving(router.fetchFn, () => "i1");
    await mkdir(join(rootDir, ROOT_LAYOUT.warmPrefixesDir), { recursive: true });

    const warm = await api.warmOpening(SLUG, request);

    expect(warm).toMatchObject({ created: true, tokens: 321, restoredSlots: 3 });
    expect(router.seen.every((entry) => entry.authorization === "Bearer key")).toBe(true);
    const action = (path: string): string => {
      const url = new URL(path, "http://router");
      return url.pathname + (url.searchParams.has("action") ? `:${url.searchParams.get("action")}` : "");
    };
    expect(router.seen.map((entry) => action(entry.path))).toEqual([
      "/slots",
      "/apply-template",
      "/apply-template",
      "/tokenize",
      "/slots/0:erase",
      "/completion",
      "/slots/0:save",
      "/slots/1:restore",
      "/slots/2:restore",
    ]);
    expect(await readdir(join(rootDir, ROOT_LAYOUT.warmPrefixesDir))).toHaveLength(2);

    // The opening stays warm in the same instance: the slots are not touched again.
    const before = router.seen.length;
    await expect(api.warmOpening(SLUG, request)).resolves.toMatchObject({ created: true });
    expect(router.seen).toHaveLength(before);
    await api.close();
  });

  it("restores the saved opening, without prefilling, into a new instance of the model", async () => {
    const router = fakeRouter(3);
    let instance = "i1";
    const api = serving(router.fetchFn, () => instance);
    await mkdir(join(rootDir, ROOT_LAYOUT.warmPrefixesDir), { recursive: true });
    await api.warmOpening(SLUG, request);

    instance = "i2";
    router.seen.length = 0;
    const warm = await api.warmOpening(SLUG, request);

    expect(warm).toMatchObject({ created: false, restoredSlots: 3 });
    expect(router.seen.some((entry) => entry.path.startsWith("/completion"))).toBe(false);
    expect(router.seen.filter((entry) => entry.path.includes("action=restore"))).toHaveLength(3);
    await api.close();
  });

  it("leaves a request without a long system prompt cold", async () => {
    const router = fakeRouter(3);
    const api = serving(router.fetchFn, () => "i1");

    await expect(
      api.warmOpening(SLUG, { messages: [{ role: "system", content: "short" }, { role: "user", content: "go" }] }),
    ).resolves.toBeNull();
    expect(router.seen).toHaveLength(0);
    await api.close();
  });

  it("scores candidate replies through the model's router entry", async () => {
    const router = fakeRouter(1);
    const api = serving(router.fetchFn, () => "i1");
    const items = [{ messages: [{ role: "user", content: "yes or no?" }], continuations: ["yes", "no"] }];

    await expect(api.scoreContinuations(SLUG, items)).resolves.toEqual([{ log_probs: [-0.5, -2], tokens: [1, 1], prompt_tokens: 412 }]);
    expect(router.seen.at(-1)).toMatchObject({
      method: "POST",
      path: "/v1/natlang/score",
      authorization: "Bearer key",
      body: { model: SLUG, items },
    });
  });

  it("forwards the native decision transport fields without changing sampled reasoning ids", async () => {
    const scored: ScoreResult = {
      log_probs: [-0.5, -2], tokens: [1, 1], prompt_tokens: 412,
      open_reply: true, reasoning: true, split_tokenization: true,
      native_decision_capture: { request_id: "mock-native-score" },
    };
    const router = fakeRouter(1, scored);
    const api = serving(router.fetchFn, () => "i1");
    const controller = new AbortController();
    const item: ScoreItem = {
      messages: [{ role: "user", content: "Choose the saved value." }],
      continuations: ["first", "second"],
      adapters: [{ id: "active-adapter", scale: 0.75 }],
      native_state_modes: { input: "same-base-adapter-state" },
      native_recording: true,
      cache_messages: 1,
      open_reply: true,
      reasoning: "The saved value is the first one.",
      reasoning_ids: [0, 17, 65535],
      split_tokenization: true,
    };
    const before = structuredClone(item);
    try {
      await expect(api.scoreContinuations(SLUG, [item], controller.signal)).resolves.toEqual([scored]);
      expect(router.seen.at(-1)).toEqual({
        method: "POST",
        path: "/v1/natlang/score",
        authorization: "Bearer key",
        signal: controller.signal,
        body: { model: SLUG, items: [before] },
      });
      expect(item).toEqual(before);
    } finally {
      await api.close();
    }
  });

  it("warms the opening of the prompts it scores before scoring them", async () => {
    const router = fakeRouter(3);
    const api = serving(router.fetchFn, () => "i1");
    await mkdir(join(rootDir, ROOT_LAYOUT.warmPrefixesDir), { recursive: true });
    const items = [
      { messages: [{ role: "system", content: OPENING }, { role: "user", content: "first" }], continuations: ["yes", "no"] },
      { messages: [{ role: "system", content: OPENING }, { role: "user", content: "second" }], continuations: ["yes", "no"] },
    ];

    await api.scoreContinuations(SLUG, items);

    const paths = router.seen.map((entry) => new URL(entry.path, "http://router").pathname);
    expect(paths.lastIndexOf("/completion")).toBeLessThan(paths.indexOf("/v1/natlang/score"));
    expect(paths.filter((path) => path === "/completion")).toHaveLength(1);
    expect(paths.filter((path) => path === "/v1/natlang/score")).toHaveLength(1);
    await api.close();
  });

  it("rejects a scoring request the server refused", async () => {
    const api = serving((async () => new Response("bad items", { status: 400 })) as typeof fetch, () => "i1");

    await expect(api.scoreContinuations(SLUG, [])).rejects.toThrow(/scoring failed with HTTP 400: bad items/);
  });
});
