import { canonicalJson } from "@vibestudio/content-addressing";
import { anyOf, methodCapability, relationship } from "@vibestudio/shared/authorization";
import { DurableObjectBase, rpc } from "@workspace/runtime/worker/kernel";
import { DevelopmentStore } from "@workspace-workers/development/store";
import type { DevelopmentAuditReceiver, NativeAuditAddress, NativeAuditKeep, NativeAuditSeed } from "./contract.js";

const ownedOperation = {
  website: { kind: "closed", reason: "This actor holds disposable owned development audit rows." },
  requires: anyOf(methodCapability("host"), relationship("workspace-role", "root")),
  effect: { kind: "open" },
  tier: "open",
  sensitivity: "write",
} as const;

export class DevelopmentAuditFixtureDO extends DurableObjectBase implements DevelopmentAuditReceiver {
  private get store() {
    return new DevelopmentStore(this.sql, operation => this.ctx.storage.transactionSync(operation));
  }
  protected createTables() {
    this.store.createTables();
    this.sql.exec("CREATE TABLE IF NOT EXISTS fixture_scope (id INTEGER PRIMARY KEY CHECK (id = 1), scope TEXT NOT NULL)");
  }
  private verifyScope(scope: string) {
    const row = this.sql.exec("SELECT scope FROM fixture_scope WHERE id=1").toArray()[0];
    if (!row || row.scope !== scope) throw new Error("Unknown development audit scope");
  }
  private readOwned(input: NativeAuditAddress) {
    this.verifyScope(input.scope);
    const run = this.store.getRun(input.run);
    if (!run || run.ownerRuntimeId !== input.scope || run.ownerUserId !== null) return null;
    const session = this.store.getSession(run.sessionId);
    if (!session || session.owner.runtimeId !== input.scope || session.owner.userId !== null) return null;
    const plan = this.store.getPlan(run.runId);
    return {
      run, session,
      planMatches: plan.runId === run.runId && canonicalJson(plan.snapshot) === canonicalJson(run.snapshot) &&
        canonicalJson(plan.recipe) === canonicalJson(run.recipe),
    };
  }
  @rpc(ownedOperation)
  async seed(input: NativeAuditSeed) {
    if (this.sql.exec("SELECT id FROM fixture_scope WHERE id=1").toArray().length) throw new Error("Development audit already seeded");
    if (!input.scope.startsWith("owned-development-") || input.entries.length > 3 || input.sessions.length > 3 ||
      input.entries.some(({ journal }) => journal.length > 8)) throw new Error("Invalid development audit seed");
    this.ctx.storage.transactionSync(() => {
      const store = new DevelopmentStore(this.sql, operation => operation());
      for (const session of input.sessions) store.putSession(session);
      for (const { run, journal } of input.entries) {
        const accepted = { ...run, state: "accepted" as const, commitPoint: "none" as const, updatedAt: run.createdAt,
          terminalAt: null, repair: null, artifact: null, instance: null };
        store.putRun(accepted, { runId: run.runId, recipe: run.recipe, snapshot: run.snapshot }, run.snapshot.snapshotDigest);
        for (const entry of journal) store.appendEvent(run.runId, entry.kind, entry.payload, entry.at);
        store.transitionRun({ runId: run.runId, expected: ["accepted"], state: run.state, commitPoint: run.commitPoint,
          message: "Retained development state", repair: run.repair, artifact: run.artifact, instance: run.instance,
          terminal: run.terminalAt !== null, at: run.updatedAt });
      }
      this.sql.exec("INSERT INTO fixture_scope VALUES (1, ?)", input.scope);
    });
  }
  @rpc(ownedOperation)
  async read(input: NativeAuditAddress) {
    return this.readOwned(input);
  }
  @rpc(ownedOperation)
  async events(input: NativeAuditAddress & { after: number }) {
    if (!this.readOwned(input)) throw new Error("No owned development run");
    if (!Number.isSafeInteger(input.after) || input.after < 0) throw new Error("Invalid native cursor");
    return this.store.listEvents(input.run, input.after, 2);
  }
  @rpc(ownedOperation)
  async keep(input: NativeAuditKeep) {
    const owned = this.readOwned(input);
    const run = owned?.run;
    if (!run || !owned.planMatches || owned.session.state !== "ready" || owned.session.contextEffect !== "owned" ||
      run.snapshot.snapshotDigest !== input.snapshot || run.updatedAt !== input.updatedAt ||
      run.snapshot.contextId !== owned.session.contextId || run.state !== "requires-repair" ||
      run.repair?.attention !== "actionable" || run.commitPoint === "none") throw new Error("Development keep precondition changed");
    const repair = { ...run.repair, attention: "kept" as const };
    return this.ctx.storage.transactionSync(() => {
      const store = new DevelopmentStore(this.sql, operation => operation());
      store.recordRunIntent({ runId: input.run, operation: "repair", idempotencyKey: input.scope, intent: { runId: input.run, action: "keep" } });
      const updated = store.transitionRun({
        runId: input.run, expected: ["requires-repair"], state: "requires-repair",
        message: "Retained for repair", repair, at: run.updatedAt + 1,
      });
      const event = store.listEvents(input.run, 0).events.at(-1);
      if (!event) throw new Error("Development keep event missing");
      return { run: updated, event };
    });
  }
  @rpc(ownedOperation)
  async proof(input: { scope: string }) {
    this.verifyScope(input.scope);
    const runs = this.store.listRuns({});
    const sessions = [
      ...this.store.listSessions({ runtimeId: input.scope, userId: null }, { limit: 3 }),
      ...this.store.listSessions({ runtimeId: input.scope + "-private", userId: null }, { limit: 3 }),
    ];
    const journals = runs.map(run => this.store.listEvents(run.runId, 0).events);
    const intents = this.sql.exec("SELECT run_id,operation,idempotency_key FROM development_mutation_intents ORDER BY run_id")
      .toArray().map(row => ({ runId: String(row.run_id), operation: String(row.operation), key: String(row.idempotency_key) }));
    return { runs, sessions, journals, intents };
  }
}
