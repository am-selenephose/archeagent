import { mkdirSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { assertSqliteProcessBoundary } from "../src/server/concord/sqlite-confinement";
import { initializeLocalState, openLocalRuntime, readLocalIdentity, type LocalIdentity } from "../src/server/concord/local-runtime";
import { LOCAL_ROOT, resolveLocalPaths, writePrivateFile, type LocalPaths } from "../src/server/concord/local-paths";
import { openConfinedConcordRepositories, openConfinedDatabase } from "../src/server/concord/confined-database";
import { ensurePrivateStoreSchema, readSourceRevision } from "../src/server/concord/private-store";
import { FramedChannel } from "../src/server/concord/framed-channel";
import { MAX_REQUEST, MAX_SNAPSHOT, parseBundle, operationSchema, requestDigest, auditMetadataSchema } from "../src/server/concord/durable-protocol";

const requestsDDL = "CREATE TABLE durable_ipc_requests(request_id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, tool TEXT NOT NULL, request_digest TEXT NOT NULL, response_json TEXT NOT NULL)";
function pathsFor(name: string): LocalPaths {
  const stateDir = join(LOCAL_ROOT, ".concord/test-harness", name);
  mkdirSync(stateDir, { mode: 0o700 });
  return { rootDir: LOCAL_ROOT, stateDir, concordDb: join(stateDir, "concord.sqlite"), recorderDb: join(stateDir, "recorder.sqlite"), sourceFile: join(stateDir, "source.json") };
}
function schema(db: Database.Database): string {
  // '_' is a LIKE wildcard. Ignore only SQLite's literal reserved prefix,
  // never lookalike user objects such as sqliteX_unapproved.
  return JSON.stringify(db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE substr(name,1,7) <> 'sqlite_' ORDER BY type,name").all());
}
function validateDb(db: Database.Database, expected: string): void {
  db.pragma("hard_heap_limit = 67108864");
  db.pragma("trusted_schema = OFF");
  if (db.inTransaction || db.pragma("integrity_check", { simple: true }) !== "ok" || (db.pragma("foreign_key_check") as unknown[]).length || schema(db) !== expected) throw new Error("Snapshot database rejected");
}

async function main() {
  if (process.argv.length !== 2) throw new Error("Worker options rejected");
  assertSqliteProcessBoundary(resolveLocalPaths());
  const paths = pathsFor("durable-worker");
  const clients = new Map<string, { client: Client; runtime: ReturnType<typeof openLocalRuntime> }>();
  let identity: LocalIdentity | undefined, concordSchema = "", recorderSchema = "";
  let concord: Database.Database | undefined, recorder: Database.Database | undefined;
  const channel = new FramedChannel(process.stdout, process.stdin, MAX_SNAPSHOT * 2 + 1024);
  let queue: Promise<void> = Promise.resolve();
  let failed = false;
  function refuse() { failed = true; process.exitCode = 1; process.stdin.destroy(); }
  channel.on("failure", refuse);
  function snapshot(): Buffer {
    if (!identity || !concord || !recorder) throw new Error("Worker not ready");
    validateDb(concord, concordSchema); validateDb(recorder, recorderSchema);
    const payload = Buffer.from(JSON.stringify({ version: "archeagent.durable-state.v1", identity, concord: concord.serialize().toString("base64"), recorder: recorder.serialize().toString("base64") }));
    parseBundle(payload); return payload;
  }
  async function initialize(payload: Buffer) {
    if (identity) throw new Error("Worker already initialized");
    if (payload.length) {
      const restored = parseBundle(payload);
      for (const [filename, data] of [[paths.concordDb, restored.concord], [paths.recorderDb, restored.recorder]]) writePrivateFile(paths, filename, Buffer.from(data, "base64"), true);
      writePrivateFile(paths, paths.sourceFile, JSON.stringify(restored.identity), true);
      identity = readLocalIdentity(paths);
    } else { identity = initializeLocalState(paths); }
    // Derive schema authority from unchanged migration code, not snapshot SQL.
    const reference = pathsFor("durable-reference");
    const refConcord = openConfinedConcordRepositories(reference).db;
    const refRecorder = openConfinedDatabase(reference, "recorder");
    try { ensurePrivateStoreSchema(refRecorder, identity); refRecorder.exec(requestsDDL); concordSchema = schema(refConcord); recorderSchema = schema(refRecorder); }
    finally { refRecorder.close(); refConcord.close(); }
    // No migration or application invocation is allowed before restored schema validation.
    concord = new Database(paths.concordDb, { fileMustExist: true });
    recorder = new Database(paths.recorderDb, { fileMustExist: true });
    if (!payload.length) recorder.exec(requestsDDL);
    validateDb(concord, concordSchema); validateDb(recorder, recorderSchema);
    if (concord.pragma("user_version", { simple: true }) !== 11) throw new Error("Snapshot schema version rejected");
    const row = recorder.prepare("SELECT identity_json FROM local_identity WHERE singleton=1").get() as { identity_json: string } | undefined;
    if (!row || row.identity_json !== JSON.stringify(identity)) throw new Error("Snapshot identity rejected");
    for (const db of [concord, recorder]) { db.pragma("foreign_keys = ON"); db.pragma("journal_mode = WAL"); db.pragma("wal_autocheckpoint = 0"); }
    await channel.send(Buffer.concat([Buffer.from([0]), snapshot()]));
  }
  async function operation(payload: Buffer) {
    if (!identity || !recorder || payload.length > MAX_REQUEST) throw new Error("Worker request rejected");
    const request = operationSchema.parse(JSON.parse(payload.toString("utf8")));
    const digest = requestDigest(request);
    const existing = recorder.prepare("SELECT * FROM durable_ipc_requests WHERE request_id=?").get(request.id) as { actor_id: string; request_digest: string; response_json: string } | undefined;
    let result: unknown;
    if (existing) {
      if (existing.actor_id !== request.actor || existing.request_digest !== digest) throw new Error("Retry identity mismatch");
      result = JSON.parse(existing.response_json);
    } else {
      const count = recorder.prepare("SELECT COUNT(*) AS count FROM durable_ipc_requests").get() as { count: number };
      if (count.count >= 10000) throw new Error("Retry ledger full");
      let bound = clients.get(request.actor);
      if (!bound) {
        const runtime = openLocalRuntime(request.actor, identity.captureRunId, paths);
        const client = new Client({ name: "scripted-durable-IPC-client", version: "1" });
        const [local, remote] = InMemoryTransport.createLinkedPair();
        await runtime.server.connect(remote); await client.connect(local); bound = { client, runtime }; clients.set(request.actor, bound);
      }
      result = await bound.client.callTool({ name: request.tool, arguments: request.args });
      const response = JSON.stringify(result); if (Buffer.byteLength(response) > 1024 * 1024) throw new Error("Worker response bound exceeded");
      recorder.prepare("INSERT INTO durable_ipc_requests VALUES(?,?,?,?,?)").run(request.id, request.actor, request.tool, digest, response);
    }
    const bundle = snapshot();
    await channel.send(Buffer.concat([Buffer.from([0]), Buffer.from(JSON.stringify({ result, snapshot: bundle.toString("base64"), sourceInstanceId: identity.sourceInstanceId, captureRunId: identity.captureRunId }))]));
  }
  channel.on("frame", (frame: Buffer) => {
    if (failed) return;
    queue = queue.then(async () => {
      // Destroying stdin does not cancel frames already parsed into the FIFO.
      // A protocol/acquisition failure terminally fences those successors too.
      if (failed) return;
      if (frame[0] === 0) await initialize(frame.subarray(1));
      else if (frame[0] === 1) await operation(frame.subarray(1));
      else if (frame[0] === 2 && frame.length === 1 && identity && concord && recorder) {
        const count = (table: "invocations" | "durable_ipc_requests") => (recorder!.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;
        const metadata = auditMetadataSchema.parse({ sourceInstanceId: identity.sourceInstanceId, captureRunId: identity.captureRunId, sourceRevision: readSourceRevision(concord), invocationCount: count("invocations"), retryCount: count("durable_ipc_requests"), walActive: concord.pragma("journal_mode", { simple: true }) === "wal", provenance: "scripted_protocol_test" });
        await channel.send(Buffer.concat([Buffer.from([0]), Buffer.from(JSON.stringify(metadata))]));
      }
      else throw new Error("Worker request rejected");
    }).catch(refuse);
  });
  await new Promise<void>(resolve => process.stdin.once("close", resolve)); await queue;
  for (const bound of clients.values()) { await bound.client.close(); await bound.runtime.close(); }
  concord?.close(); recorder?.close();
  // No raw body or snapshot data is printed on stderr.
}
void main().catch(() => { process.stderr.write("Confined durable worker refused state.\n"); process.exitCode = 1; process.stdin.destroy(); });
