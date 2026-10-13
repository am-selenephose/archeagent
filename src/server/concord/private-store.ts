import type Database from "better-sqlite3";
import { openConfinedDatabase } from "./confined-database";
import { z } from "zod";
import { assertLocalAcquisitionGate, validateLocalPaths, type LocalPaths } from "./local-paths";
import { readLocalIdentity, type LocalIdentity } from "./local-runtime";

export const sourceRevisionSchema = z.object({ eventId: z.number().int().nonnegative(), ownershipEventId: z.number().int().nonnegative(), updateId: z.number().int().nonnegative(), handoffId: z.number().int().nonnegative(), reviewId: z.number().int().nonnegative(), messageEventId: z.number().int().nonnegative(), taskCount: z.number().int().nonnegative(), taskVersionSum: z.number().int().nonnegative() }).strict();
export type SourceRevision = z.infer<typeof sourceRevisionSchema>;
const recordRefsSchema = z.object({ taskId: z.string().max(128).optional(), eventIds: z.array(z.number().int().positive()).max(256).optional(), ownershipEventIds: z.array(z.number().int().positive()).max(256).optional(), updateId: z.number().int().positive().optional(), handoffId: z.number().int().positive().optional(), messageIds: z.array(z.string().max(128)).max(100).optional(), endpointId: z.string().max(128).optional() }).strict();
export const invocationSchema = z.object({ invocationId: z.uuid(), version: z.literal("archeagent.invocation.v1"), sourceInstanceId: z.uuid(), captureRunId: z.uuid(), serverInstanceId: z.uuid(), actorId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,127}$/), tool: z.enum(["start_work", "inspect_work", "update_work", "transfer_work", "finish_work", "register_pull_endpoint", "drain_own_inbox"]), taskId: z.string().max(128).nullable(), startedAt: z.iso.datetime(), finishedAt: z.iso.datetime(), outcome: z.enum(["succeeded", "rejected", "failed", "db_committed_export_failed"]), recordRefs: recordRefsSchema, sourceRevision: sourceRevisionSchema, provenance: z.enum(["current_capture", "scripted_protocol_test"]) }).strict();
export type Invocation = z.infer<typeof invocationSchema>;

/** Companion-owned schema only; no tables are added to Concord's database. */
export function ensurePrivateStoreSchema(db: Database.Database, identity: LocalIdentity): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS local_identity (singleton INTEGER PRIMARY KEY CHECK(singleton=1), version TEXT NOT NULL, source_instance_id TEXT NOT NULL, capture_run_id TEXT NOT NULL, identity_json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS invocations (invocation_id TEXT PRIMARY KEY, version TEXT NOT NULL, source_instance_id TEXT NOT NULL, capture_run_id TEXT NOT NULL, server_instance_id TEXT NOT NULL, actor_id TEXT NOT NULL, tool TEXT NOT NULL, task_id TEXT, started_at TEXT NOT NULL, finished_at TEXT NOT NULL, outcome TEXT NOT NULL, record_refs_json TEXT NOT NULL, source_revision_json TEXT NOT NULL, provenance TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS invocations_scope_time ON invocations(source_instance_id,capture_run_id,finished_at,invocation_id);
    CREATE TABLE IF NOT EXISTS execution_receipts (receipt_id TEXT PRIMARY KEY, source_instance_id TEXT NOT NULL, capture_run_id TEXT NOT NULL, actor_id TEXT NOT NULL, task_id TEXT NOT NULL, tested_tree_digest TEXT NOT NULL, envelope_json TEXT NOT NULL, receipt_digest TEXT NOT NULL, source_revision_json TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS session_links (link_id TEXT PRIMARY KEY, source_instance_id TEXT NOT NULL, capture_run_id TEXT NOT NULL, actor_id TEXT NOT NULL, thread_id TEXT NOT NULL, metadata_digest TEXT NOT NULL, observed_at TEXT NOT NULL, status TEXT NOT NULL);
  `);
  const existing = db.prepare("SELECT identity_json FROM local_identity WHERE singleton=1").get() as { identity_json: string } | undefined;
  if (existing && existing.identity_json !== JSON.stringify(identity)) throw new Error("Local companion source mismatch.");
  if (!existing) db.prepare("INSERT INTO local_identity VALUES(1,?,?,?,?)").run(identity.version, identity.sourceInstanceId, identity.captureRunId, JSON.stringify(identity));
}

export function openPrivateStore(paths: LocalPaths) {
  assertLocalAcquisitionGate(paths);
  validateLocalPaths(paths);
  const identity = readLocalIdentity(paths);
  const db = openConfinedDatabase(paths, "recorder", { fileMustExist: true });
  try {
    db.pragma("busy_timeout = 5000"); db.pragma("foreign_keys = ON");
    const row = db.prepare("SELECT identity_json FROM local_identity WHERE singleton=1").get() as { identity_json: string } | undefined;
    if (!row || row.identity_json !== JSON.stringify(identity)) throw new Error("Local companion source mismatch.");
    validateLocalPaths(paths);
  } catch (error) { db.close(); throw error; }
  return {
    db, identity,
    appendInvocation(input: Invocation): void {
      const entry = invocationSchema.parse(input);
      if (entry.sourceInstanceId !== identity.sourceInstanceId || entry.captureRunId !== identity.captureRunId || entry.provenance !== identity.provenance) throw new Error("Local invocation scope mismatch.");
      validateLocalPaths(paths);
      db.prepare("INSERT INTO invocations VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(entry.invocationId, entry.version, entry.sourceInstanceId, entry.captureRunId, entry.serverInstanceId, entry.actorId, entry.tool, entry.taskId, entry.startedAt, entry.finishedAt, entry.outcome, JSON.stringify(entry.recordRefs), JSON.stringify(entry.sourceRevision), entry.provenance);
      validateLocalPaths(paths);
    },
    // Descriptor cleanup does not acquire a path; rejected state must never
    // prevent releasing an already-owned SQLite connection.
    close() { if (db.open) db.close(); },
  };
}

/** Revision pairs are reconciliation evidence, not cross-database atomicity. */
export function readSourceRevision(db: Database.Database): SourceRevision {
  const revision = db.transaction(() => {
    const max = (table: string) => (db.prepare(`SELECT COALESCE(MAX(id),0) AS value FROM ${table}`).get() as { value: number }).value;
    const tasks = db.prepare("SELECT COUNT(*) AS count,COALESCE(SUM(version),0) AS sum FROM tasks").get() as { count: number; sum: number };
    return { eventId: max("events"), ownershipEventId: max("task_ownership_events"), updateId: max("task_updates"), handoffId: max("handoffs"), reviewId: max("reviews"), messageEventId: max("agent_message_events"), taskCount: tasks.count, taskVersionSum: tasks.sum };
  })();
  return sourceRevisionSchema.parse(revision);
}
