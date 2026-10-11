import { describe, expect, it, vi } from "vitest";
import { mainRpcMethods } from "@vibestudio/service-schemas/mainRpc";
import type { ExtensionContext } from "@vibestudio/extension";
import { activate } from "./index.js";

describe("@workspace-extensions/mobile-debug", () => {
  it("delegates native effects to the host without reading workspace paths", async () => {
    const call = vi.fn(
      async (
        _target: string,
        _method: { name: string },
        _args: unknown[],
        _options?: unknown,
      ) => ({ apkBytes: 3 }),
    );
    const stream = vi.fn(async () => new Response("logs"));
    const healthy = vi.fn();
    const api = await activate({
      rpc: { call, stream, emit: vi.fn(), on: vi.fn() },
      health: { healthy },
    } as unknown as ExtensionContext);

    await expect(
      api.buildAndroid({ architectures: ["arm64-v8a"] }),
    ).resolves.toEqual({ apkBytes: 3 });
    expect(call).toHaveBeenCalledTimes(1);
    expect(call.mock.calls[0]?.[0]).toBe("main");
    expect(call.mock.calls[0]?.[1]).toMatchObject({
      name: mainRpcMethods["mobileNative.buildAndroid"].name,
    });
    expect(call.mock.calls[0]?.[2]).toEqual([{ architectures: ["arm64-v8a"] }]);
    expect(call.mock.calls[0]?.[3]).toBeUndefined();
    expect(healthy).toHaveBeenCalledWith(
      expect.objectContaining({
        summary: expect.stringContaining("Host mobile executor"),
      }),
    );
  });

  it("routes streaming methods over the RPC stream boundary", async () => {
    const response = new Response("device logs");
    const stream = vi.fn(async () => response);
    const api = await activate({
      rpc: { call: vi.fn(), stream, emit: vi.fn(), on: vi.fn() },
      health: { healthy: vi.fn() },
    } as unknown as ExtensionContext);

    await expect(api.logcat({ device: "phone-1" })).resolves.toBe(response);
    expect(stream).toHaveBeenCalledWith(
      "main",
      mainRpcMethods["mobileNative.logcat"],
      [{ device: "phone-1" }],
    );
  });
});
