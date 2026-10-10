import { mainRpcMethods } from "@vibestudio/service-schemas/mainRpc";
import { createTypedRpcServiceClient } from "@vibestudio/shared/typedRpcServiceClient";
import { mobileNativeMethods } from "@vibestudio/service-schemas/mobileNative";
import type { ExtensionContext } from "@vibestudio/extension";

export type Api = Awaited<ReturnType<typeof activate>>;
declare module "@vibestudio/extension" {
  interface WorkspaceExtensions {
    "@workspace-extensions/mobile-debug": Api;
  }
}

/** Userland presentation for the installed host's native mobile executor. */
export async function activate(ctx: ExtensionContext) {
  const native = createTypedRpcServiceClient(ctx.rpc, { targetId: "main", namespace: "mobileNative" }, mobileNativeMethods);
  ctx.health.healthy({
    summary: "Host mobile executor available through reviewed RPC",
  });

  return {
    doctor: () => native.doctor(),
    listDevices: () => native.listDevices(),
    listIosSimulators: () => native.listIosSimulators(),
    buildAndroid: (input?: { device?: string; architectures?: string[] }) =>
      native.buildAndroid(input),
    installAndroid: (input?: {
      device?: string;
      resetApp?: boolean;
      launch?: boolean;
    }) => native.installAndroid(input),
    installIos: (input?: {
      device?: string;
      simulator?: boolean;
      configuration?: "Debug" | "Release" | "Internal";
      launch?: boolean;
    }) => native.installIos(input),
    launchAndroid: (input?: { device?: string; packageName?: string }) =>
      native.launchAndroid(input),
    launchIos: (input?: { device?: string; bundleId?: string }) =>
      native.launchIos(input),
    clearAndroidApp: (input?: { device?: string; packageName?: string }) =>
      native.clearAndroidApp(input),
    adbReverse: (input: { device?: string; ports: Array<[number, number]> }) =>
      native.adbReverse(input),
    screenshot: (input?: { device?: string }) => native.screenshot(input),
    screenshotIos: (input?: { device?: string }) =>
      native.screenshotIos(input),
    verify: (input?: { device?: string; packageName?: string }) =>
      native.verify(input),
    verifyWorkspaceReady: (input?: {
      device?: string;
      packageName?: string;
      sinceMs?: number;
      timeoutMs?: number;
    }) => native.verifyWorkspaceReady(input),
    logcat: (input?: {
      device?: string;
      packageName?: string;
      filter?: string;
    }) => ctx.rpc.stream("main", mainRpcMethods["mobileNative.logcat"], [input]),
    logsIos: (input?: { device?: string; predicate?: string }) =>
      ctx.rpc.stream("main", mainRpcMethods["mobileNative.logsIos"], [input]),
    shell: (input: { device?: string; command: string; args?: string[] }) =>
      ctx.rpc.stream("main", mainRpcMethods["mobileNative.shell"], [input]),
  };
}
