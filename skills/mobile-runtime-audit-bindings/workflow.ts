import { extensions } from "@workspace/runtime";
import { mobileNativeMethods } from "@vibestudio/service-schemas/mobileNative";
import type { AndroidAuditRequest, AndroidRuntimeObservation, AndroidTargetObservation } from "../mobile-runtime-audit/types.js";

const internalPackage = "app.vibestudio.mobile.internal";

export async function listAndroidAuditDevices() {
  return mobileNativeMethods.listDevices.returns.parse(
    await extensions.invoke("@workspace-extensions/mobile-debug", "listDevices", []),
  );
}

export function bindAndroidRuntimeAudit(assignment: Omit<AndroidAuditRequest, "operationId">) {
  const request = { ...assignment, operationId: crypto.randomUUID() };
  const { operationId, intent, target } = request;
  let targetObservation: Promise<AndroidTargetObservation> | undefined;
  let application: Promise<AndroidRuntimeObservation> | undefined;

  async function readApplication(): Promise<AndroidRuntimeObservation> {
    const native = mobileNativeMethods.verify.returns.parse(
      await extensions.invoke("@workspace-extensions/mobile-debug", "verify", [
        { device: target, packageName: internalPackage },
      ]),
    );
    return {
      target, packageName: internalPackage, installed: native.installed,
      processObserved: native.bundleActive, screenshotCaptured: native.screenshotCaptured,
      screenshotBytes: native.screenshotBytes, issues: native.issues,
    };
  }

  return {
    request,
    services: {
      androidRuntimeAudit: {
        async observeTarget(id: string): Promise<AndroidTargetObservation> {
          if (id !== operationId) throw new Error("Unknown assigned Android audit");
          targetObservation ??= listAndroidAuditDevices().then((devices) => ({
            target, state: devices.find(({ serial }) => serial === target)?.state ?? null,
          }));
          return structuredClone(await targetObservation);
        },
        async observeApplication(id: string): Promise<AndroidRuntimeObservation> {
          if (id !== operationId || intent !== "application" || (await targetObservation)?.state !== "device")
            throw new Error("Inspect the exact ready Android target assigned for application verification");
          return structuredClone(await (application ??= readApplication()));
        },
      },
    },
  };
}
