import { chmodSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { ModelRecord } from "@workspace/model-catalog/localModels";

/** Sole current metadata owner. Connections and write transactions never outlive an operation. */
export function modelRecordStore(file: string) {
  function access<T>(write: boolean, operation: (db: DatabaseSync) => T): T {
    const db = new DatabaseSync(file);
    let transaction = false;
    let failed = false;
    let failure: unknown;
    try {
      chmodSync(file, 0o600);
      db.exec(
        "CREATE TABLE IF NOT EXISTS models (slug TEXT PRIMARY KEY, file TEXT NOT NULL UNIQUE, record TEXT NOT NULL)",
      );
      if (write) {
        db.exec("BEGIN IMMEDIATE");
        transaction = true;
      }
      const result = operation(db);
      if (transaction) {
        db.exec("COMMIT");
        transaction = false;
      }
      return result;
    } catch (original) {
      failed = true;
      failure = original;
      if (transaction) {
        try {
          db.exec("ROLLBACK");
        } catch (cleanup) {
          failure = new AggregateError(
            [original, cleanup],
            "Model metadata transaction and rollback failed",
            { cause: original },
          );
        }
      }
      throw failure;
    } finally {
      try {
        db.close();
      } catch (cleanup) {
        if (failed)
          throw new AggregateError(
            [failure, cleanup],
            "Model metadata operation and connection close failed",
            { cause: failure },
          );
        throw cleanup;
      }
    }
  }

  function read(db: DatabaseSync, slug: string): ModelRecord | null {
    const row = db
      .prepare("SELECT record FROM models WHERE slug = ?")
      .get(slug);
    if (!row) return null;
    if (typeof row["record"] !== "string")
      throw new Error("Invalid model metadata record");
    return JSON.parse(row["record"]) as ModelRecord;
  }

  function write(db: DatabaseSync, record: ModelRecord): void {
    db.prepare(
      "INSERT INTO models(slug, file, record) VALUES (?, ?, ?) ON CONFLICT(slug) DO UPDATE SET file = excluded.file, record = excluded.record",
    ).run(record.slug, record.file, JSON.stringify(record));
  }

  return {
    list(): ModelRecord[] {
      return access(false, (db) =>
        db
          .prepare("SELECT record FROM models ORDER BY rowid")
          .all()
          .map((row) => {
            if (typeof row["record"] !== "string")
              throw new Error("Invalid model metadata record");
            return JSON.parse(row["record"]) as ModelRecord;
          }),
      );
    },
    put(records: readonly ModelRecord[]): void {
      access(true, (db) => {
        for (const record of records) write(db, record);
      });
    },
    remove(slug: string): void {
      access(true, (db) => {
        db.prepare("DELETE FROM models WHERE slug = ?").run(slug);
      });
    },
    update(
      slug: string,
      change: (record: ModelRecord) => ModelRecord | null,
    ): boolean {
      return access(true, (db) => {
        const current = read(db, slug);
        if (!current) throw new Error(`Model ${slug} is not installed`);
        const changed = change(current);
        if (!changed) return false;
        write(db, changed);
        return true;
      });
    },
  };
}
