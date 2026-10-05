import { describe, expect, it } from "vitest";
import { durableObjectSchemaFingerprint } from "@vibestudio/durable/schema";
import { createTestDO } from "@vibestudio/durable/test-utils";
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
    primaryDiagnostic: null,
    cleanupDiagnostics: [],
  };
}

describe("development history paging", () => {
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
});
