import { isDeepStrictEqual } from "node:util";
import {assessObservedApplicationOutcome} from "@workspace-skills/system-testing/observed-application-outcome";
import type {InvocationObservations} from "@workspace-skills/system-testing/observed-invocation";
import type {
  AndroidAuditReport,
  AndroidAuditRequest,
  AndroidRuntimeObservation,
  AndroidRuntimeStatus,
  AndroidTargetObservation,
} from "../mobile-runtime-audit/types.js";

export type AndroidAuditInput = { contextId: string; caseId: string };
type World = {
  id: string;
  goal: string;
  mode: "target" | "application" | "foreign";
  expectedStatus?: AndroidRuntimeStatus;
};
type Device = { serial: string; state: "device" | "unauthorized" | "offline" };
type Binder = (assignment: Omit<AndroidAuditRequest, "operationId">) => {
  request: AndroidAuditRequest;
  services: {
    androidRuntimeAudit: {
      observeTarget(id: string): Promise<AndroidTargetObservation>;
      observeApplication(id: string): Promise<AndroidRuntimeObservation>;
    };
  };
};

export async function prepareManagedAndroidAudit(
  input: AndroidAuditInput,
  world: World,
  listDevices: () => Promise<Device[]>,
  bind: Binder,
) {
  if (world.id !== input.caseId)
    throw new Error("Android audit assignment changed");
  const initial = await listDevices();
  const emulators = initial.filter(
    ({ serial, state }) => /^emulator-\d+$/u.test(serial) && state === "device",
  );
  if (emulators.length !== 1)
    throw new Error(
      "This case requires exactly one ready disposable Android emulator",
    );
  const owned = emulators[0]!.serial;
  const absentSerial = "emulator-0";
  if (initial.some(({ serial }) => serial === absentSerial))
    throw new Error("The reserved absent emulator coordinate is present");
  const target = world.mode === "foreign" ? absentSerial : owned;
  const bound = bind({
    goal: world.goal,
    target,
    intent: world.mode === "target" ? "device" : "application",
  });
  const targets: AndroidTargetObservation[] = [];
  const applications: AndroidRuntimeObservation[] = [];
  const services = {
    androidRuntimeAudit: {
      async observeTarget(id: string) {
        const observation =
          await bound.services.androidRuntimeAudit.observeTarget(id);
        targets.push(structuredClone(observation));
        return observation;
      },
      async observeApplication(id: string) {
        const observation =
          await bound.services.androidRuntimeAudit.observeApplication(id);
        applications.push(structuredClone(observation));
        return observation;
      },
    },
  };
  const targetReview =
    world.mode === "foreign" ? "target-absent" : "target-ready";
  const shouldObserveApp = world.mode === "application";
  const expectedStatus = world.expectedStatus ?? "app-absent";
  const hasApp = expectedStatus !== "app-absent";
  const hasProcess = hasApp && expectedStatus !== "process-absent";
  const hasImage = expectedStatus === "workspace-unverified";
  const image = hasImage ? "captured" as const : "unavailable" as const;

  async function verify(report: AndroidAuditReport | null) {
    const after = await listDevices();
    const observed = targets[0];
    const application = applications[0] ?? null;
    const checks = {
      target:
        targets.length === 1 &&
        observed?.target === target &&
        observed.state === (world.mode === "foreign" ? null : "device"),
      lineage:
        after.some(
          ({ serial, state }) => serial === owned && state === "device",
        ) && !after.some(({ serial }) => serial === absentSerial),
      application: shouldObserveApp
        ? applications.length === 1 &&
          application?.target === owned &&
          application.packageName === "app.vibestudio.mobile.internal" &&
          application.installed === hasApp &&
          application.processObserved === hasProcess &&
          application.screenshotCaptured === hasImage &&
          (hasImage ? application.screenshotBytes > 0 : application.screenshotBytes === 0) &&
          (hasApp || application.issues.length > 0)
        : applications.length === 0,
      report: report?.targetObservation?.target === observed?.target &&
        report?.targetObservation?.state === observed?.state && report?.targetReview === targetReview && (shouldObserveApp
          ? report?.runtime?.status === expectedStatus && report.runtime.image === image &&
            isDeepStrictEqual(report.runtime.observation, application)
          : report?.runtime === null),
    };
    return {
      ...input,
      request: bound.request,
      owned,
      observed,
      application,
      checks,
      passed: Object.values(checks).every(Boolean),
    };
  }

  async function qualify() {
    const targetObservation = await services.androidRuntimeAudit.observeTarget(
      bound.request.operationId,
    );
    const runtime = shouldObserveApp
      ? {
          observation: await services.androidRuntimeAudit.observeApplication(
            bound.request.operationId,
          ),
          status: expectedStatus,
          image,
        }
      : null;
    return verify({ targetObservation, targetReview, runtime });
  }
  return { request: bound.request, services, qualify, verify };
}

export async function prepareOpenAndroidAudit(
  input: AndroidAuditInput & { goal: string },
  world: World,
  listDevices: () => Promise<Device[]>,
  bind: Binder,
) {
  if (input.goal !== world.goal) throw new Error("Use the original Android audit goal");
  const nativeAudit = await prepareManagedAndroidAudit(input, world, listDevices, bind);
  const { operationId, target } = nativeAudit.request;
  const scope = { operationId, target };
  let observedScope = false;
  const androidGoalAudit = {
    async readScope(goal: string) {
      if (goal !== world.goal) {
        throw new Error("Read only the exact assigned Android audit scope");
      }
      observedScope = true;
      return structuredClone(scope);
    },
  };

  // The public value is the actual requested audit, rather than a copy of its input scope.
  function evidence(native: Awaited<ReturnType<typeof nativeAudit.verify>>) {
    const checks = {
      boundExactAndroidAudit: observedScope,
      verifiedNativeAndroidTarget: native.checks.target && native.checks.lineage,
      verifiedNativeAndroidRuntime: native.checks.application,
      returnedAndroidAudit: native.checks.report,
    };
    const outcomeContract={
      effects:{checks:["boundExactAndroidAudit","verifiedNativeAndroidTarget","verifiedNativeAndroidRuntime"],
        rationale:"Actual device and application observations establish target, lineage and runtime independently of a copied public envelope."},
      returnedValue:{checks:["returnedAndroidAudit"],required:true,
        rationale:"The user's read-only request asks for the actual Android audit findings."},
      incidentalValues:{checks:[],rationale:"Known incorrect emitted audit values are excluded with their actual root definition."},
    };
    return { ...input, passed: Object.values(checks).every(Boolean), checks, scope, native, outcomeContract };
  }
  async function verify(result: unknown, invocation?:InvocationObservations) {
    const native=await nativeAudit.verify(result as AndroidAuditReport|null);
    const observed=evidence(native);
    return assessObservedApplicationOutcome({...observed,outcome:result},observed.outcomeContract,result,invocation,[{
      checks:["returnedAndroidAudit"],rootPath:[],producerSourceSuffix:"auditAndroidGoal/installed/auditAndroidRuntime.nl",
    }]);
  }

  async function qualify() {
    await androidGoalAudit.readScope(input.goal);
    return evidence(await nativeAudit.qualify());
  }

  return { services: { ...nativeAudit.services, androidGoalAudit }, verify, qualify };
}
