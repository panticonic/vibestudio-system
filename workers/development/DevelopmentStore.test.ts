import { describe, expect, it } from "vitest";
import { durableObjectSchemaFingerprint } from "@vibestudio/durable/schema";
import { createTestDO } from "@vibestudio/durable/test-utils";
import { serializeRpcFailure } from "@vibestudio/rpc";
import type { DevelopmentSession } from "@vibestudio/service-schemas/development";
import { DevelopmentDO } from "./DevelopmentDO.js";
import {
  DevelopmentStore,
  DEVELOPMENT_HISTORY_INDEXES,
  DEVELOPMENT_V1_FINGERPRINT,
} from "./DevelopmentStore.js";

async function fixture() {
  const { sql, db } = await createTestDO(DevelopmentDO, {
    WORKER_SOURCE: "vibestudio/internal",
    WORKER_CLASS_NAME: "DevelopmentDO",
    __objectKey: "workspace",
  });
  return {
    sql,
    db,
    store: new DevelopmentStore(
      sql as ConstructorParameters<typeof DevelopmentStore>[0],
      (fn) => fn(),
    ),
  };
}
function session(
  sessionId: string,
  createdAt: number,
  userId: string | null = "alice",
): DevelopmentSession {
  return {
    sessionId,
    idempotencyKey: sessionId,
    createdAt,
    updatedAt: createdAt,
    state: "ready",
    mode: "semantic",
    nativeTool: null,
    native: null,
    repository: { repositoryId: "repo", repoPath: "projects/repo" },
    contextId: sessionId,
    parentContextId: "parent",
    basis: {
      parentWorkingHead: { kind: "event", eventId: "parent" },
      childBaseState: { kind: "event", eventId: "child" },
    },
    owner: { runtimeId: "panel:development", runtimeKind: "panel", userId },
    contextEffect: "owned",
    repairAttention: null,
    primaryFailure: null,
    cleanupFailures: [],
  };
}

describe("development history paging", () => {
  it("migrates stored diagnostic fields and nested native repair into structured failures", async () => {
    const { store, sql } = await fixture();
    store.putSession(session("legacy", 10));
    const legacy = JSON.parse(
      String(
        sql
          .exec(
            "SELECT session_json FROM development_sessions WHERE session_id='legacy'",
          )
          .one()["session_json"],
      ),
    ) as Record<string, unknown>;
    delete legacy["primaryFailure"];
    delete legacy["cleanupFailures"];
    legacy["primaryDiagnostic"] = {
      code: "EIO",
      message: "legacy primary",
      at: 123,
    };
    legacy["cleanupDiagnostics"] = [
      { code: "ECLEANUP", message: "legacy cleanup", at: 124 },
    ];
    legacy["mode"] = "native-tool";
    legacy["nativeTool"] = "system-editor";
    legacy["native"] = {
      ownedRootId: "owned-root",
      executorId: "executor",
      toolId: "system-editor",
      repoPath: "projects/repo",
      baseEvent: { kind: "event", eventId: "base" },
      baseSnapshotRevision: "snapshot",
      state: "requires-repair",
      process: null,
      lastCheckpoint: null,
      pendingChanges: "unknown",
      repair: {
        phase: "stop",
        primaryError: "legacy native primary",
        cleanupErrors: ["legacy native cleanup"],
        attention: "actionable",
        knownEffects: {
          nativeTree: "owned",
          process: "unknown",
          importedEvent: "absent",
        },
      },
    };
    sql.exec(
      "UPDATE development_sessions SET session_json=? WHERE session_id='legacy'",
      JSON.stringify(legacy),
    );

    const migrated = store.getSession("legacy");
    expect(migrated).toMatchObject({
      primaryFailure: {
        message: "legacy primary",
        code: "EIO",
        errorData: { legacyDiagnosticAt: 123 },
      },
      cleanupFailures: [{ message: "legacy cleanup", code: "ECLEANUP" }],
      native: {
        repair: {
          primaryFailure: { message: "legacy native primary" },
          cleanupFailures: [{ message: "legacy native cleanup" }],
        },
      },
    });
    const persisted = JSON.parse(
      String(
        sql
          .exec(
            "SELECT session_json FROM development_sessions WHERE session_id='legacy'",
          )
          .one()["session_json"],
      ),
    ) as Record<string, unknown>;
    expect(persisted).not.toHaveProperty("primaryDiagnostic");
    expect(persisted).not.toHaveProperty("cleanupDiagnostics");

    const shared = new Error("shared remote cause");
    const graph = serializeRpcFailure(
      new AggregateError([shared, shared], "native aggregate", {
        cause: shared,
      }),
    );
    const nativeSession = {
      ownedRootId: "owned-root-2",
      executorId: "executor",
      toolId: "system-editor" as const,
      repoPath: "projects/repo",
      baseEvent: { kind: "event" as const, eventId: "base" },
      baseSnapshotRevision: "snapshot",
      state: "requires-repair" as const,
      process: null,
      lastCheckpoint: null,
      pendingChanges: "unknown" as const,
      repair: {
        phase: "checkpoint",
        primaryFailure: graph,
        cleanupFailures: [],
        attention: "actionable" as const,
        knownEffects: {
          nativeTree: "owned" as const,
          process: "unknown" as const,
          importedEvent: "absent" as const,
        },
      },
    };
    store.putSession({
      ...session("graph", 11),
      mode: "native-tool",
      nativeTool: "system-editor",
      native: nativeSession,
    });
    expect(store.getSession("graph")?.native?.repair?.primaryFailure).toEqual(
      graph,
    );
  });

  it("upgrades the exact v1 schema without discarding owned sessions", async () => {
    const { sql, db, store } = await fixture();
    store.putSession(session("kept", 10));
    const target = durableObjectSchemaFingerprint(sql);
    for (const definition of DEVELOPMENT_HISTORY_INDEXES) {
      const name = definition.match(/CREATE INDEX (\w+)/)![1];
      sql.exec(`DROP INDEX ${name}`);
    }
    expect(durableObjectSchemaFingerprint(sql)).toBe(
      DEVELOPMENT_V1_FINGERPRINT,
    );
    sql.exec(
      "UPDATE _vibestudio_schema SET version=1,shape_json=?",
      DEVELOPMENT_V1_FINGERPRINT,
    );
    const upgraded = await createTestDO(
      DevelopmentDO,
      {
        WORKER_SOURCE: "vibestudio/internal",
        WORKER_CLASS_NAME: "DevelopmentDO",
        __objectKey: "workspace",
        VIBESTUDIO_SCHEMA_DESCRIPTOR: {
          className: "DevelopmentDO",
          version: 2,
          freshSchemaFingerprint: target,
          durableWorkQueues: [],
        },
      },
      { db },
    );
    expect(
      upgraded.sql.exec("SELECT version FROM _vibestudio_schema").one()[
        "version"
      ],
    ).toBe(2);
    expect(durableObjectSchemaFingerprint(upgraded.sql)).toBe(target);
    expect(
      await upgraded.callAs(
        { callerId: "panel:development", callerKind: "panel", userId: "alice" },
        "getSession",
        { sessionId: "kept" },
      ),
    ).toMatchObject({ sessionId: "kept" });
  });
  it("bounds session decoding in SQL and resumes tied timestamps without skipping rows", async () => {
    const { store, sql } = await fixture();
    for (const value of [
      session("a", 10),
      session("b", 10),
      session("c", 9),
      session("foreign", 11, "bob"),
    ])
      store.putSession(value);
    // An older unavailable payload must not be decoded to serve this page.
    sql.exec(
      "UPDATE development_sessions SET session_json='unavailable' WHERE session_id='c'",
    );
    const plan = sql
      .exec(
        "EXPLAIN QUERY PLAN SELECT session_json FROM development_sessions WHERE owner_user_id=? ORDER BY created_at DESC,session_id ASC LIMIT ?",
        "alice",
        1,
      )
      .toArray();
    expect(plan.map((row) => String(row["detail"])).join(" ")).toContain(
      "development_sessions_user_page",
    );
    expect(plan.map((row) => String(row["detail"])).join(" ")).not.toContain(
      "TEMP B-TREE",
    );
    const owner = { runtimeId: "panel:other", userId: "alice" };
    expect(
      store.listSessions(owner, { limit: 1 }).map((row) => row.sessionId),
    ).toEqual(["a"]);
    expect(
      store
        .listSessions(owner, {
          limit: 1,
          cursor: { createdAt: 10, sessionId: "a" },
        })
        .map((row) => row.sessionId),
    ).toEqual(["b"]);
    expect(
      store.listSessions(
        { runtimeId: "panel:development", userId: null },
        { limit: 1 },
      ),
    ).toEqual([]);
  });
  it("filters run cursors and counts active work without decoding historical payloads", async () => {
    const { store, sql } = await fixture();
    for (const [id, state] of [
      ["a", "building"],
      ["b", "stopped"],
      ["c", "ready"],
    ]) {
      sql.exec(
        `INSERT INTO development_runs (run_id,owner_runtime_id,owner_user_id,session_id,state,run_json,plan_json,start_intent_digest,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
        id,
        "panel:development",
        "alice",
        "session",
        state,
        "unavailable",
        "{}",
        "digest",
        10,
        10,
      );
    }
    expect(store.activeRunCount("session")).toBe(2);
    expect(store.activeRunCount("other")).toBe(0);
    expect(
      store.listRuns({
        owner: { runtimeId: "panel:development", userId: "alice" },
        cursor: { createdAt: 10, runId: "z" },
        limit: 1,
      }),
    ).toEqual([]);
    expect(store.listRuns({ sessionId: "other", limit: 1 })).toEqual([]);
    expect(store.listRuns({ state: "succeeded", limit: 1 })).toEqual([]);
  });
  it("migrates persisted run repair diagnostics into canonical failures", async () => {
    const { store, sql } = await fixture();
    const hash = "a".repeat(64);
    const repository = (name: string) => ({
      repositoryId: `repository:${name}`,
      repoPath: `projects/${name}`,
      repositoryState: {
        kind: "application",
        applicationId: `application:${name}`,
      },
      repositoryManifestDigest: hash,
      materializedTreeDigest: hash,
      contentRoot: `state:${hash}`,
      sourcePlanDigest: hash,
    });
    const legacyRun = {
      version: 1,
      runId: "legacy-run",
      sessionId: "legacy-session",
      ownerRuntimeId: "worker:one",
      ownerRuntimeKind: "worker",
      ownerUserId: "alice",
      attachedHostAuthorityCeiling: null,
      target: { kind: "build-only" },
      recipe: {
        version: 1,
        recipeId: "recipe:legacy",
        label: "Legacy recipe",
        target: { kind: "build-only" },
        executor: "node-pnpm",
        install: {
          lockfiles: ["pnpm-lock.yaml"],
          mode: "frozen",
          network: "approved-registry",
          registry: "https://registry.npmjs.org",
        },
        commands: [
          { id: "install-root", executable: "pnpm", args: [] },
          { id: "build-host", executable: "pnpm", args: [] },
        ],
        declaredEnvironment: { CI: "1", NODE_ENV: "production" },
        platform: "linux",
        arch: "x64",
        reviewDigest: hash,
      },
      snapshot: {
        version: 1,
        sessionId: "legacy-session",
        contextId: "context:legacy",
        pair: {
          kind: "combined",
          host: repository("host"),
          base: repository("base"),
          personal: repository("personal"),
          system: repository("system"),
          pairDigest: hash,
        },
        recipeDigest: hash,
        toolchain: {
          executorId: hash,
          node: { digest: hash, version: "22", platform: "linux", arch: "x64" },
          pnpm: { digest: hash, version: "10" },
          hostSourceBuild: { digest: hash },
        },
        declaredEnvironment: {},
        environmentDigest: hash,
        lockfileDigest: hash,
        snapshotDigest: hash,
      },
      state: "failed",
      commitPoint: "snapshot-retained",
      artifact: null,
      instance: null,
      hostReadiness: null,
      client: null,
      attachedHost: null,
      repair: {
        phase: "building",
        primaryError: {
          code: "ELEGACY",
          message: "legacy run failure",
          at: 123,
        },
        cleanupErrors: [
          { code: "ECLEANUP", message: "legacy run cleanup", at: 124 },
        ],
        retryable: true,
        attention: "actionable",
        knownEffects: {
          executionRoot: "unknown",
          process: "absent",
          artifact: "absent",
        },
      },
      createdAt: 1,
      updatedAt: 1,
      terminalAt: 2,
    };
    sql.exec(
      `INSERT INTO development_runs
       (run_id,owner_runtime_id,owner_user_id,session_id,state,run_json,plan_json,start_intent_digest,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      "legacy-run",
      "worker:one",
      "alice",
      "legacy-session",
      "failed",
      JSON.stringify(legacyRun),
      "{}",
      "digest",
      1,
      2,
    );

    expect(store.getRun("legacy-run")?.repair).toMatchObject({
      primaryFailure: { message: "legacy run failure", code: "ELEGACY" },
      cleanupFailures: [{ message: "legacy run cleanup", code: "ECLEANUP" }],
    });
    const persisted = JSON.parse(
      String(
        sql
          .exec(
            "SELECT run_json FROM development_runs WHERE run_id='legacy-run'",
          )
          .one()["run_json"],
      ),
    ) as { repair: Record<string, unknown> };
    expect(persisted.repair).not.toHaveProperty("primaryError");
    expect(persisted.repair).not.toHaveProperty("cleanupErrors");
  });
});
