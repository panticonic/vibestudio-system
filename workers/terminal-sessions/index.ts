import { DurableObjectBase, rpc } from "@workspace/runtime/worker/kernel";
import type { TerminalSessionRecord, TerminalSessionRegistry } from "./contract.js";

export type { TerminalSessionRecord } from "./contract.js";

/** Bounds that keep one person's rows reasonable; they reject, never truncate silently. */
const MAX_SETTINGS_BYTES = 4096;
const MAX_TITLE_LENGTH = 80;
const MAX_FIELD_LENGTH = 512;

const REGISTRY_RPC = {
  website: {
    kind: "closed",
    reason: "Terminal sessions belong to a person's own terminal browser.",
  },
  principals: ["host", "user", "code"],
  effect: { kind: "open" },
  tier: "open",
} as const;

interface SessionRow {
  session_id: string;
  workspace_id: string;
  source: string;
  class_name: string;
  title: string;
  context_id: string;
  created_at: number;
  last_attached_at: number;
}

/**
 * The terminal browser's server-side memory: which sessions each person has
 * (so detach is not close, and sessions resume across browser restarts and
 * devices) and their terminal settings (prefix key, bell, ...).
 *
 * Rows are partitioned by the authenticated caller's user id, so one person
 * can never list, resume or rename another person's sessions. The session DOs
 * themselves own their content; this registry only remembers how to find them.
 */
export class TerminalSessionsDO extends DurableObjectBase implements TerminalSessionRegistry {
  static override schemaVersion = 1;

  protected createTables(): void {
    this.sql.exec(`CREATE TABLE terminal_sessions (
      owner TEXT NOT NULL,
      session_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      source TEXT NOT NULL,
      class_name TEXT NOT NULL,
      title TEXT NOT NULL,
      context_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      last_attached_at INTEGER NOT NULL,
      PRIMARY KEY (owner, session_id)
    )`);
    this.sql.exec(`CREATE TABLE terminal_settings (
      owner TEXT PRIMARY KEY,
      settings TEXT NOT NULL
    )`);
  }

  protected override requiredTables(): readonly string[] {
    return ["terminal_sessions", "terminal_settings"];
  }

  /** The person this call is attributed to; principals without a user are their own partition. */
  private owner(): string {
    const caller = this.caller;
    if (!caller) throw new Error("Terminal session registry calls require an authenticated caller");
    return caller.userId ? `user:${caller.userId}` : `caller:${caller.callerId}`;
  }

  @rpc({ ...REGISTRY_RPC, sensitivity: "read" })
  async listSessions(workspaceId: string): Promise<TerminalSessionRecord[]> {
    const rows = this.sql
      .exec(
        `SELECT * FROM terminal_sessions WHERE owner = ? AND workspace_id = ?
         ORDER BY last_attached_at DESC`,
        this.owner(),
        field(workspaceId, "workspaceId")
      )
      .toArray() as unknown as SessionRow[];
    return rows.map(toRecord);
  }

  @rpc({ ...REGISTRY_RPC, sensitivity: "write" })
  async recordSession(
    session: Pick<
      TerminalSessionRecord,
      "sessionId" | "workspaceId" | "source" | "className" | "title" | "contextId"
    >
  ): Promise<TerminalSessionRecord> {
    const sessionId = field(session?.sessionId, "sessionId");
    const workspaceId = field(session?.workspaceId, "workspaceId");
    const source = field(session?.source, "source");
    const className = field(session?.className, "className");
    const contextId = field(session?.contextId, "contextId");
    const title = cleanTitle(session?.title);
    const now = Date.now();
    this.sql.exec(
      `INSERT INTO terminal_sessions
         (owner, session_id, workspace_id, source, class_name, title, context_id,
          created_at, last_attached_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (owner, session_id) DO UPDATE SET
         title = excluded.title, last_attached_at = excluded.last_attached_at`,
      this.owner(),
      sessionId,
      workspaceId,
      source,
      className,
      title,
      contextId,
      now,
      now
    );
    const row = this.row(sessionId);
    if (
      row.workspace_id !== workspaceId ||
      row.source !== source ||
      row.class_name !== className ||
      row.context_id !== contextId
    ) {
      throw new Error(
        `Terminal session ${sessionId} already exists for a different workspace, app or context`
      );
    }
    return toRecord(row);
  }

  @rpc({ ...REGISTRY_RPC, sensitivity: "write" })
  async markAttached(sessionId: string): Promise<void> {
    this.row(sessionId);
    this.sql.exec(
      `UPDATE terminal_sessions SET last_attached_at = ? WHERE owner = ? AND session_id = ?`,
      Date.now(),
      this.owner(),
      sessionId
    );
  }

  @rpc({ ...REGISTRY_RPC, sensitivity: "write" })
  async setSessionTitle(sessionId: string, title: string): Promise<void> {
    this.row(sessionId);
    this.sql.exec(
      `UPDATE terminal_sessions SET title = ? WHERE owner = ? AND session_id = ?`,
      cleanTitle(title),
      this.owner(),
      sessionId
    );
  }

  @rpc({ ...REGISTRY_RPC, sensitivity: "write" })
  async forgetSession(sessionId: string): Promise<void> {
    this.sql.exec(
      `DELETE FROM terminal_sessions WHERE owner = ? AND session_id = ?`,
      this.owner(),
      field(sessionId, "sessionId")
    );
  }

  @rpc({ ...REGISTRY_RPC, sensitivity: "read" })
  async getSettings(): Promise<Record<string, unknown>> {
    const row = this.sql
      .exec(`SELECT settings FROM terminal_settings WHERE owner = ?`, this.owner())
      .toArray()[0] as { settings: string } | undefined;
    if (!row) return {};
    const parsed = JSON.parse(row.settings) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  }

  @rpc({ ...REGISTRY_RPC, sensitivity: "write" })
  async setSettings(settings: Record<string, unknown>): Promise<void> {
    if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
      throw new Error("Terminal settings must be an object");
    }
    const json = JSON.stringify(settings);
    if (json.length > MAX_SETTINGS_BYTES) {
      throw new Error(`Terminal settings exceed ${MAX_SETTINGS_BYTES} bytes`);
    }
    this.sql.exec(
      `INSERT INTO terminal_settings (owner, settings) VALUES (?, ?)
       ON CONFLICT (owner) DO UPDATE SET settings = excluded.settings`,
      this.owner(),
      json
    );
  }

  private row(sessionId: string): SessionRow {
    const row = this.sql
      .exec(
        `SELECT * FROM terminal_sessions WHERE owner = ? AND session_id = ?`,
        this.owner(),
        field(sessionId, "sessionId")
      )
      .toArray()[0] as unknown as SessionRow | undefined;
    if (!row) throw new Error(`Unknown terminal session: ${sessionId}`);
    return row;
  }
}

function toRecord(row: SessionRow): TerminalSessionRecord {
  return {
    sessionId: row.session_id,
    workspaceId: row.workspace_id,
    source: row.source,
    className: row.class_name,
    title: row.title,
    contextId: row.context_id,
    createdAt: Number(row.created_at),
    lastAttachedAt: Number(row.last_attached_at),
  };
}

function field(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_FIELD_LENGTH) {
    throw new Error(`Terminal session ${name} must be a non-empty string`);
  }
  return value;
}

function cleanTitle(value: unknown): string {
  const title = typeof value === "string" ? value : "";
  // eslint-disable-next-line no-control-regex
  const clean = title
    .replace(/[\x00-\x1f\x7f-\x9f]/g, " ")
    .trim()
    .slice(0, MAX_TITLE_LENGTH);
  return clean || "Untitled session";
}
