import { schemaRpcMock } from "@vibestudio/rpc/test-utils";
import type { RpcWireCaller } from "@vibestudio/rpc/internal";
import { describe, expect, it } from "vitest";
import { createModels, createProvider, Type } from "@panticonic/pi-ai";
import { openAICompletionsApi } from "@panticonic/pi-ai/api/openai-completions.lazy";
import { BACKGROUND_CONTEXT } from "@panticonic/pi-chord/context";
import {
  createRegistry,
  defineExtension,
  MemoryStorage,
  type ToolRegistration,
} from "@panticonic/pi-durable";
import type { RpcCaller } from "@vibestudio/rpc";
import { openBoundAgentSession } from "@workspace/agentic-do/native-agent-session";
import {
  createProtectedModelProvider,
  createProtectedModelAuth,
} from "@workspace/agentic-do/native-model-provider";
import { FALLBACK_MODEL } from "./constants.js";

describe("native local provider admission", () => {
  it("refuses raw and ambient credentials and propagates exact cancellation", async () => {
    const auth = createProtectedModelAuth();
    const ctx = {
      env: async () => {
        throw new Error("Ambient credentials must not be read");
      },
      fileExists: async () => false,
    };
    const controller = new AbortController();
    expect(
      await auth.resolve({ ctx, signal: controller.signal }),
    ).toBeUndefined();
    expect(
      await auth.resolve({
        ctx,
        credential: { type: "api_key", key: "raw-loopback-secret" },
        signal: controller.signal,
      }),
    ).toBeUndefined();
    const original = new Error("Original protected local cancellation");
    controller.abort(original);
    await expect(auth.resolve({ ctx, signal: controller.signal })).rejects.toBe(
      original,
    );
  });
  it.each([true, false])(
    "runs the exact local registry and protected port with observed tools capability %s without model weights",
    async (toolsCapable) => {
      const models = createModels();
      models.setProvider(
        createProvider({
          id: "local",
          name: "Local models",
          auth: { apiKey: createProtectedModelAuth() },
          api: openAICompletionsApi(),
          models: [
            {
              id: FALLBACK_MODEL.slug,
              name: "Fallback",
              provider: "local",
              api: "openai-completions",
              baseUrl: "http://127.0.0.1:0/v1",
              reasoning: false,
              input: ["text"],
              contextWindow: 131072,
              maxTokens: 256,
              capabilities: { tools: toolsCapable },
              compat: { supportsReasoningEffort: false },
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            },
          ],
        }),
      );
      const calls: number[] = [];
      const parameters = Type.Object({ a: Type.Number(), b: Type.Number() });
      const add: ToolRegistration<typeof parameters> = {
        name: "add",
        description: "Add numbers",
        parameters,
        async execute(args, _api, context) {
          context.abortSignal?.throwIfAborted();
          calls.push(args.a + args.b);
          return { content: [{ type: "text", text: String(args.a + args.b) }] };
        },
      };
      const registry = createRegistry();
      registry.install(
        defineExtension({ name: "native-local-regression", tools: [add] }),
      );
      const invoked: string[] = [];
      const rpc: RpcCaller = schemaRpcMock({
        async call(...invocation: Parameters<RpcWireCaller["call"]>) {
          const [_target, method, args, options] = invocation;
          options?.signal?.throwIfAborted();
          expect(method).toBe("extensions.invoke");
          expect(args[0]).toBe("@workspace-extensions/local-models");
          invoked.push(String(args[1]));
          const value =
            args[1] === "ensureLoaded"
              ? { baseUrl: "http://127.0.0.1:32123/v1" }
              : args[1] === "getLoopbackAuth"
                ? {
                    apiKey: "component-loopback-key",
                    origins: ["http://127.0.0.1:32123"],
                  }
                : undefined;
          if (!value) throw new Error("Unexpected local method");
          return value;
        },
        stream: () => {
          throw new Error("Component has no RPC stream");
        },
      });
      let requests = 0;
      const session = await openBoundAgentSession(
        new MemoryStorage(),
        {
          runtimeId: "do:tests/local:NativeLocal:component",
          contextId: "ctx-native-local-component",
          incarnation: "component-incarnation",
          authoritySessionId: "component-lifetime",
        },
        {
          models,
          registry,
          publishWake: async () => {},
          modelRequests: createProtectedModelProvider({
            rpcForRequest: () => rpc,
            waitForAuthority: async () => {
              throw new Error("Unexpected component approval");
            },
            egressFetch: async (input, init) => {
              expect(String(input)).toBe(
                "http://127.0.0.1:32123/v1/chat/completions",
              );
              expect(new Headers(init?.headers).get("authorization")).toBe(
                "Bearer component-loopback-key",
              );
              requests++;
              const delta =
                requests === 1
                  ? {
                      role: "assistant",
                      tool_calls: [
                        {
                          index: 0,
                          id: "add-original",
                          type: "function",
                          function: {
                            name: "add",
                            arguments: '{"a":17,"b":25}',
                          },
                        },
                      ],
                    }
                  : { role: "assistant", content: "42" };
              const chunk = (delta: unknown, finish_reason: string | null) => ({
                id: "original-model-response",
                object: "chat.completion.chunk",
                model: FALLBACK_MODEL.slug,
                choices: [{ index: 0, delta, finish_reason }],
              });
              return new Response(
                `data: ${JSON.stringify(chunk(delta, null))}\n\ndata: ${JSON.stringify(chunk({}, toolsCapable && requests === 1 ? "tool_calls" : "stop"))}\n\ndata: [DONE]\n\n`,
                { headers: { "content-type": "text/event-stream" } },
              );
            },
          }),
        },
        BACKGROUND_CONTEXT,
      );
      try {
        const conversation = await session.root(BACKGROUND_CONTEXT, {
          agent: {
            model: { provider: "local", modelId: FALLBACK_MODEL.slug },
            tools: [add],
          },
        });
        const input = await conversation.submit(
          {
            type: "input",
            requestId: "original-local-component",
            content: "Use add for17 plus25",
          },
          BACKGROUND_CONTEXT,
        );
        const outcome = await input.wait(BACKGROUND_CONTEXT);
        if (outcome.status !== "done") {
          console.info(
            "Exact local component native terminal",
            JSON.stringify(outcome),
          );
          console.info(
            "Exact local component native entries",
            JSON.stringify(
              (
                await conversation.entries(
                  {},
                  100,
                  undefined,
                  BACKGROUND_CONTEXT,
                )
              ).items,
            ),
          );
        }
        expect(outcome).toMatchObject({ status: "done" });
        expect(calls).toEqual(toolsCapable ? [42] : []);
        expect(requests).toBe(toolsCapable ? 2 : 1);
        expect(invoked).toEqual(
          toolsCapable
            ? [
                "ensureLoaded",
                "getLoopbackAuth",
                "ensureLoaded",
                "getLoopbackAuth",
              ]
            : ["ensureLoaded", "getLoopbackAuth"],
        );
      } finally {
        await session.close(BACKGROUND_CONTEXT);
      }
    },
  );
});
