/**
 * Live native Session / protected ModelPort proof against real local servers and
 * weights. The test host supplies an explicit execution owner; it does not
 * claim to prove production host authentication or mailbox routing (those have
 * their own real workerd tests). No legacy vessel driver or work queue is used.
 *
 * RUN_LOCAL_MODELS_E2E=1 uses an explicitly prepared private model profile.
 * The switch case additionally requires the original 350M sibling. Model responses, tool execution, and model switching
 * all run through the installed native kernel and production loopback port.
 */
import { describe, expect, it } from "vitest";
import path from "node:path";
import { createModels, createProvider, Type } from "@panticonic/pi-ai";
import { openAICompletionsApi } from "@panticonic/pi-ai/api/openai-completions.lazy";
import {
  BACKGROUND_CONTEXT,
  withAbortSignal,
} from "@panticonic/pi-chord/context";
import {
  AssistantEntry,
  ToolResultEntry,
  MemoryStorage,
  createRegistry,
  defineExtension,
  type ToolRegistration,
  type Conversation,
} from "@panticonic/pi-durable";
import { openBoundAgentSession } from "@workspace/agentic-do/native-agent-session";
import {
  createProtectedModelProvider,
  createProtectedModelAuth,
} from "@workspace/agentic-do/native-model-provider";
import type { RpcCaller } from "@vibestudio/rpc";
import { activate } from "./index.js";
import { FALLBACK_MODEL } from "./constants.js";

const RUN = process.env["RUN_LOCAL_MODELS_E2E"] === "1";
const TEST_TIMEOUT_MS = 20 * 60_000; // Investigation bound for real CPU prefill; never recovery policy.

interface NativeLocalFixture {
  conversation: Conversation;
  context: import("@panticonic/pi-chord").Context;
  calls: Array<{ a: number; b: number; taskId: number }>;
  loads: string[];
  models: string[];
}

async function withLocalAgent(
  importedModels: Array<{ directory: string; sha256: string }>,
  operation: (fixture: NativeLocalFixture) => Promise<void>,
): Promise<void> {
  if (!process.env["VIBESTUDIO_LOCAL_MODELS_DIR"])
    throw new Error(
      "Live native local-model tests require an explicitly prepared private VIBESTUDIO_LOCAL_MODELS_DIR",
    );
  const disposables: Array<{ dispose(): void | Promise<void> }> = [];
  const controller = new AbortController();
  const context = withAbortSignal(controller.signal, BACKGROUND_CONTEXT);
  const lifecycleLog: string[] = [];
  const local = await activate({
    log: {
      info: (...args) => {
        const line = args
          .map((value) =>
            typeof value === "string" ? value : JSON.stringify(value),
          )
          .join(" ")
          .slice(0, 4096);
        lifecycleLog.push(line);
        if (lifecycleLog.length > 200) lifecycleLog.shift();
      },
    },
    emit: () => {},
    subscriptions: {
      push: (disposable) => {
        disposables.push(disposable);
      },
    },
  });
  let session: Awaited<ReturnType<typeof openBoundAgentSession>> | undefined;
  let original: unknown;
  try {
    await local.installModel(FALLBACK_MODEL.slug, {
      contextLength: null,
      gpuLayers: 0,
    });
    const modelIds: string[] = [FALLBACK_MODEL.slug];
    for (const artifact of importedModels) {
      const admitted = await local.importDir(
        path.join(
          process.env["VIBESTUDIO_LOCAL_MODELS_DIR"]!,
          artifact.directory,
        ),
        { contextLength: null, gpuLayers: 0 },
      );
      const exact = admitted.find(
        (record) => record.sha256 === artifact.sha256,
      );
      if (!exact)
        throw new Error(
          "Live model import did not admit the exact verified artifact",
        );
      modelIds.push(exact.slug);
    }
    const descriptors = await local.listModels();
    const selected = modelIds.map((id) => {
      const model = descriptors.find((candidate) => candidate.slug === id);
      if (!model)
        throw new Error(
          `Live native model-switch proof requires actual local library model ${id}`,
        );
      return model;
    });
    const models = createModels();
    models.setProvider(
      createProvider({
        id: "local",
        name: "Local models",
        auth: { apiKey: createProtectedModelAuth() },
        api: openAICompletionsApi(),
        models: selected.map((entry) => ({
          id: entry.slug,
          name: entry.displayName,
          provider: "local",
          api: "openai-completions" as const,
          baseUrl: entry.baseUrl,
          reasoning: entry.reasoningCapable,
          input: ["text" as const],
          contextWindow: entry.contextWindow,
          maxTokens: 256,
          capabilities: { tools: entry.toolsCapable },
          compat: { supportsReasoningEffort: false },
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        })),
      }),
    );
    const loads: string[] = [];
    const rpcForContext = (
      nativeContext: import("@panticonic/pi-chord").Context,
    ): RpcCaller => ({
      async call<T>(...invocation: Parameters<RpcCaller["call"]>) {
        const [target, method, args, options] = invocation;
        context.abortSignal?.throwIfAborted();
        expect(target).toBe("main");
        expect(method).toBe("extensions.invoke");
        expect(options?.signal).toBe(nativeContext.abortSignal);
        const [extension, name, input] = args;
        if (
          extension !== "@workspace-extensions/local-models" ||
          !Array.isArray(input)
        )
          throw new Error("Unexpected protected local model invocation");
        let value: unknown;
        if (name === "ensureLoaded" && typeof input[0] === "string") {
          loads.push(input[0]);
          value = await local.ensureLoaded(input[0]);
        } else if (name === "getLoopbackAuth")
          value = await local.getLoopbackAuth();
        else throw new Error(`Unexpected local model method ${String(name)}`);
        return value as T;
      },
      stream: () => {
        throw new Error("Local host fixture has no RPC streams");
      },
    });
    const calls: Array<{ a: number; b: number; taskId: number }> = [];
    const addParameters = Type.Object({
      a: Type.Number(),
      b: Type.Number(),
    });
    const add: ToolRegistration<typeof addParameters> = {
      name: "add",
      description:
        "Add two numbers; use the result rather than computing the answer yourself.",
      parameters: addParameters,
      async execute(args, api, nativeContext) {
        nativeContext.abortSignal?.throwIfAborted();
        calls.push({ a: args.a, b: args.b, taskId: api.taskId });
        return {
          content: [{ type: "text", text: String(args.a + args.b) }],
          details: { sum: args.a + args.b },
        };
      },
    };
    const registry = createRegistry();
    registry.install(
      defineExtension({ name: "live-native-local-tools", tools: [add] }),
    );
    session = await openBoundAgentSession(
      new MemoryStorage(),
      {
        runtimeId: "do:tests/local:NativeLocal:live",
        contextId: "ctx-live-local",
        incarnation: "host-fixture-local-incarnation",
        authoritySessionId: "host-fixture-local-lifetime",
      },
      {
        models,
        registry,
        publishWake: async () => {},
        modelRequests: createProtectedModelProvider({
          rpcForRequest: (_request, _api, nativeContext) =>
            rpcForContext(nativeContext),
          egressFetch: fetch,
          waitForAuthority: async () => {
            throw new Error(
              "Trusted local test host unexpectedly requested approval",
            );
          },
        }),
      },
      context,
    );
    const conversation = await session.root(context, {
      agent: {
        model: { provider: "local", modelId: FALLBACK_MODEL.slug },
        tools: [add],
        instructions:
          "When asked for arithmetic always invoke add with the exact numbers, then answer briefly using its result.",
      },
    });
    await operation({ conversation, context, calls, loads, models: modelIds });
  } catch (error) {
    original = error;
  } finally {
    controller.abort(new Error("Live native local model test finished"));
    const diagnostics = await Promise.allSettled(
      (["main", "utility"] as const).map(async (which) => {
        const lines = await local.tailServerLogLines(which, 200);
        console.info(
          `Native local-model ${which} engine stdout/stderr`,
          lines.map((line) => line.slice(0, 4096)).join("\n"),
        );
      }),
    );
    const cleanup = await Promise.allSettled([
      ...(session ? [session.close(BACKGROUND_CONTEXT)] : []),
      ...disposables.map((disposable) =>
        Promise.resolve().then(() => disposable.dispose()),
      ),
    ]);
    const failures = [...diagnostics, ...cleanup].flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    );
    if (original !== undefined) failures.unshift(original);
    console.info(
      "Native local-model engine/lifecycle diagnostics",
      lifecycleLog.join("\n"),
    );
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1)
      throw new AggregateError(
        failures,
        "Live native local model test and cleanup failed",
        { cause: failures[0] },
      );
  }
}

async function verifyToolRound({
  conversation,
  context,
  calls,
  loads,
}: NativeLocalFixture) {
  const first = await conversation.submit(
    {
      type: "input",
      requestId: "live-local-original",
      content:
        "Use add to calculate 17 plus 25, then give the resulting number.",
    },
    context,
  );
  const outcome = await first.wait(context);
  if (outcome.status !== "done") {
    console.info(
      "Native local-model original submission outcome",
      JSON.stringify(outcome).slice(0, 8192),
    );
    const entries = await conversation.entries({}, 100, undefined, context);
    console.info(
      "Native local-model canonical failure entries",
      JSON.stringify(entries.items).slice(0, 32768),
    );
  }
  expect(outcome.status).toBe("done");
  await conversation.waitForIdle(context);
  const entries = (await conversation.entries({}, 100, undefined, context))
    .items;
  expect(calls).toEqual([
    expect.objectContaining({ a: 17, b: 25, taskId: expect.any(Number) }),
  ]);
  expect(entries.some((entry) => ToolResultEntry.is(entry))).toBe(true);
  const answer = entries
    .filter((entry) => AssistantEntry.is(entry))
    .flatMap((entry) => entry.model ?? [])
    .filter(
      (message) =>
        message.role === "assistant" && message.stopReason !== "toolUse",
    );
  expect(answer.length).toBeGreaterThan(0);
  expect(JSON.stringify(answer)).toContain("42");
  expect(loads).toContain(FALLBACK_MODEL.slug);
  return entries;
}

describe.runIf(RUN)("native agent turn with real local models", () => {
  it(
    "executes a real native tool round with the fallback local model",
    async () => {
      await withLocalAgent([], async (fixture) => {
        await verifyToolRound(fixture);
      });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "executes a real native tool round and then switches local server models",
    async () => {
      await withLocalAgent(
        [
          {
            directory: "models/LiquidAI/LFM2.5-350M-GGUF",
            sha256:
              "7e6f72643caafc9a68256686638c4d7916f2cec76d1df478d4c3ddcd95a6aed4",
          },
        ],
        async (fixture) => {
          const { conversation, context, loads, models } = fixture;
          const switchedModel = models[1];
          if (!switchedModel)
            throw new Error(
              "Native switch fixture has no admitted second model",
            );
          const entries = await verifyToolRound(fixture);
          await conversation.configure(
            { model: { provider: "local", modelId: switchedModel } },
            context,
          );
          const second = await conversation.submit(
            {
              type: "input",
              requestId: "live-local-switched",
              content: "Say hello in a short phrase.",
            },
            context,
          );
          expect((await second.wait(context)).status).toBe("done");
          await conversation.waitForIdle(context);
          expect(loads).toContain(switchedModel);
          const nextEntries = (
            await conversation.entries({}, 100, undefined, context)
          ).items;
          const frontier = Math.max(...entries.map((entry) => entry.id));
          const secondAnswers = nextEntries.filter(
            (entry) => entry.id > frontier && AssistantEntry.is(entry),
          );
          expect(
            secondAnswers.some((entry) =>
              entry.model?.some(
                (message) =>
                  message.role === "assistant" &&
                  message.content.some(
                    (part) =>
                      part.type === "text" && part.text.trim().length > 0,
                  ),
              ),
            ),
          ).toBe(true);
        },
      );
    },
    TEST_TIMEOUT_MS,
  );
});
