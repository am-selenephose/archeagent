import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs, { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, symlinkSync, linkSync, writeFileSync, chmodSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join, dirname } from "node:path";
import Database from "better-sqlite3";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { handleStartWork } from "@concord-ai/concord-mcp/dist/tools/workflow.js";
import { resolveLocalPaths, validateLocalPaths, writePrivateFile, type LocalPaths } from "../src/server/concord/local-paths";
import { initializeLocalState, readLocalIdentity, openLocalRuntime } from "../src/server/concord/local-runtime";
import { openPrivateStore } from "../src/server/concord/private-store";
import { isSqliteProcessConfined } from "../src/server/concord/sqlite-confinement";
import { runIsolatedConcordCheck } from "../src/server/concord/isolated-process";

// These are scripted SDK protocol tests, never model-session evidence.
const harnesses: string[] = [];
const closers: (() => Promise<void>)[] = [];
function fixture(): LocalPaths {
  const rootDir = "/home/nur/Projects/archeagent-final-staging";
  const stateDir = join(rootDir, ".concord", "test-harness", `adapter-${randomUUID()}`);
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  harnesses.push(stateDir);
  return { rootDir, stateDir, concordDb: join(stateDir, "concord.sqlite"), recorderDb: join(stateDir, "recorder.sqlite"), sourceFile: join(stateDir, "source.json") };
}
async function clientFor(paths: LocalPaths, actor: string) {
  const identity = readLocalIdentity(paths);
  const runtime = openLocalRuntime(actor, identity.captureRunId, paths);
  const client = new Client({ name: "scripted-protocol-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await runtime.server.connect(serverTransport);
  await client.connect(clientTransport);
  closers.push(async () => { await client.close(); await runtime.close(); });
  return { client, runtime };
}
async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  return await client.callTool({ name, arguments: args });
}
function structured(result: Awaited<ReturnType<typeof call>>) {
  return result.structuredContent as Record<string, unknown>;
}
afterEach(async () => {
  for (const close of closers.splice(0)) await close();
  for (const dir of harnesses.splice(0)) rmSync(dir, { recursive: true, force: true });
});

if (!isSqliteProcessConfined()) {
  describe("fixed-root Concord adapter kernel-isolated protocol harness", () => {
    it("runs every existing protocol regression in a private writable filesystem and preserves historical host state", async () => {
      expect(execFileSync("git", ["rev-parse", "--git-common-dir"], { cwd: resolveLocalPaths().rootDir, encoding: "utf8" }).trim()).toBe("/home/nur/Projects/archeagent-concord-hiring/.git");
      const historical = "/home/nur/Projects/archeagent-concord-hiring/.concord";
      const snapshot = () => ["concord.db", "concord.db-wal", "concord.db-shm", "WORK_STATE.json", "events.jsonl", "HANDOFF.md", "REVIEW_PACKET.md"].map(name => {
        const filename = join(historical, name);
        if (!existsSync(filename)) return { name, missing: true };
        const stat = lstatSync(filename);
        return { name, size: stat.size, mtime: stat.mtimeMs, hash: createHash("sha256").update(readFileSync(filename)).digest("hex") };
      });
      const before = snapshot();
      const result = await runIsolatedConcordCheck("adapter-tests");
      expect(result.exitCode, result.stderr + result.stdout).toBe(0);
      expect(result.stdout).toMatch(/29 passed/);
      expect(snapshot()).toEqual(before);
      expect(existsSync(resolveLocalPaths().concordDb)).toBe(false);
    }, 120000);
  });
} else describe("fixed-root Concord adapter (scripted protocol tests)", () => {
  it("holds real source acquisition before any SQLite write until independent isolation is repaired", () => {
    const paths = resolveLocalPaths();
    for (const filename of [paths.sourceFile, paths.concordDb, paths.recorderDb]) expect(existsSync(filename)).toBe(false);
    expect(() => initializeLocalState(paths)).toThrow("Local SQLite isolation gate is held");
    expect(() => openLocalRuntime("builder", randomUUID(), paths)).toThrow("Local SQLite isolation gate is held");
    expect(() => openPrivateStore(paths)).toThrow("Local SQLite isolation gate is held");
    for (const filename of [paths.sourceFile, paths.concordDb, paths.recorderDb]) expect(existsSync(filename)).toBe(false);
  });
  it("keeps a real linked worktree source under staging without consulting Git common-dir", () => {
    // A regression to stock/common-dir resolution would redirect these files.
    const paths = resolveLocalPaths();
    // The host harness independently checks the actual linked-worktree Git
    // boundary. Neither its common Git directory nor database is mounted here.
    const commonDir = "/home/nur/Projects/archeagent-concord-hiring/.git";
    expect(paths.concordDb).toBe("/home/nur/Projects/archeagent-final-staging/.concord/concord.sqlite");
    const bad = { ...paths, rootDir: dirname(commonDir), stateDir: join(dirname(commonDir), ".concord") };
    expect(() => validateLocalPaths(bad)).toThrow();
  });

  it("initializes empty genuine repositories and persists one source/run identity", async () => {
    // Inventing agents at initialization or minting identities on read breaks this contract.
    const paths = fixture();
    const first = initializeLocalState(paths);
    expect(readLocalIdentity(paths)).toEqual(first);
    expect(initializeLocalState(paths)).toEqual(first);
    expect(first.provenance).toBe("scripted_protocol_test");
    const { runtime } = await clientFor(paths, "builder");
    expect(runtime.repos.agents.list()).toEqual([]);
    expect(runtime.repos.tasks.list()).toEqual([]);
    expect(() => openLocalRuntime("builder", randomUUID(), paths)).toThrow();
  });

  it.each(["concord.sqlite", "concord.sqlite-wal", "concord.sqlite-shm", "recorder.sqlite-wal", "WORK_STATE.json", "events.jsonl", "source.json", "access-secret", "receipt-key.pem"])("rejects a symlinked %s before acquiring state", (filename) => {
    // Omitting any acquisition-side path validation permits a linked write target.
    const paths = fixture();
    const target = join(paths.stateDir, "owned-target");
    writeFileSync(target, "untouched");
    symlinkSync(target, join(paths.stateDir, filename));
    expect(() => initializeLocalState(paths)).toThrow();
    expect(readFileSync(target, "utf8")).toBe("untouched");
    expect(existsSync(paths.recorderDb)).toBe(false);
  });

  it("rejects hardlinks, directories as database files, and special state files", () => {
    // Following multi-link or FIFO targets risks outside aliases or blocking acquisitions.
    for (const kind of ["hardlink", "directory", "fifo"]) {
      const paths = fixture();
      if (kind === "hardlink") { const target = join(paths.stateDir, "owned-target"); writeFileSync(target, "untouched"); linkSync(target, paths.concordDb); }
      if (kind === "directory") mkdirSync(paths.concordDb);
      if (kind === "fifo") execFileSync("mkfifo", [paths.concordDb]);
      expect(() => initializeLocalState(paths)).toThrow();
      expect(existsSync(paths.sourceFile)).toBe(false);
    }
  });

  it("rejects foreign workspace/root/acting actor before genuine writes while retaining peer work inspection", async () => {
    // Upstream silently ignores foreign workspace selection without a manager.
    const paths = fixture(); initializeLocalState(paths);
    const { client, runtime } = await clientFor(paths, "builder");
    for (const invalid of [{ workspace_id: "foreign" }, { root: paths.rootDir }, { repo_root: paths.rootDir }, { agent_id: "reviewer" }]) {
      const result = await call(client, "start_work", { task_id: "forbidden", title: "Forbidden", kind: "codex", ...invalid });
      expect(result.isError).toBe(true);
    }
    expect(runtime.repos.tasks.get("forbidden")).toBeUndefined();
    expect(runtime.repos.agents.list()).toEqual([]);
    const reviewer = await clientFor(paths, "reviewer");
    await call(reviewer.client, "start_work", { task_id: "peer", title: "Peer work", kind: "codex", expected_files: ["src/peer.ts"] });
    const result = await call(client, "inspect_work", { agent_id: "reviewer" });
    expect(result.isError).not.toBe(true);
    expect(JSON.stringify(result)).toContain("peer");
    expect(structured(result).inbox).toBeUndefined();
  });

  it("records actual overlap, fresh-version release, addressed transfer and recipient acceptance", async () => {
    // Wrong actor binding or fabricated forwarding would break real ownership/version transitions.
    const paths = fixture(); initializeLocalState(paths);
    const builder = await clientFor(paths, "builder"); const reviewer = await clientFor(paths, "reviewer");
    const a = structured(await call(builder.client, "start_work", { task_id: "build", title: "Build", kind: "codex", expected_files: ["src/approved.ts"] }));
    const b = structured(await call(reviewer.client, "start_work", { task_id: "review", title: "Review", kind: "codex", expected_files: ["src/approved.ts"] }));
    expect((b.overlaps as unknown[]).length).toBe(1);
    const stale = await call(reviewer.client, "transfer_work", { task_id: "review", action: "release", expected_version: 0 });
    expect(stale.isError).toBe(true);
    expect((await call(reviewer.client, "transfer_work", { task_id: "review", action: "release", expected_version: b.version, reason: "scripted protocol test scope release" })).isError).not.toBe(true);
    const offer = structured(await call(builder.client, "transfer_work", { task_id: "build", action: "offer", expected_version: a.version, to_agent_id: "reviewer", what_changed: "scripted protocol test addressed handoff", changed_files: ["src/approved.ts"] }));
    expect(offer.handoff_id).toBeTypeOf("number");
    expect((await call(builder.client, "transfer_work", { task_id: "build", action: "accept", expected_version: offer.version })).isError).toBe(true);
    const accepted = structured(await call(reviewer.client, "transfer_work", { task_id: "build", action: "accept", expected_version: offer.version }));
    expect(accepted.agent_id).toBe("reviewer");
    expect(builder.runtime.repos.handoffs.latestForTask("build")?.deliveryStatus).toBe("accepted");
  });

  it("delivers a queued prompt only through the bound recipient drain and keeps bodies out of invocation ledger", async () => {
    // Claiming delivery on send, foreign inbox reads, or raw-argument ledger copies violate privacy/provenance.
    const paths = fixture(); initializeLocalState(paths);
    const builder = await clientFor(paths, "builder"); const reviewer = await clientFor(paths, "reviewer");
    await call(builder.client, "register_pull_endpoint"); await call(reviewer.client, "register_pull_endpoint");
    const secret = "PRIVATE_MESSAGE_SENTINEL_66f56";
    const sent = structured(await call(builder.client, "update_work", { operation: "prompt", to_agent_id: "reviewer", content: secret, idempotency_key: "scripted-prompt-1" }));
    expect(sent.delivery).toBe("queued_pull"); expect(sent.status).toBe("pending");
    expect((await call(builder.client, "drain_own_inbox", { agent_id: "reviewer" })).isError).toBe(true);
    const drain = structured(await call(reviewer.client, "drain_own_inbox"));
    expect(JSON.stringify(drain)).toContain(secret);
    expect(builder.runtime.repos.agentMessages.get(sent.message_id as string)?.status).toBe("delivered");
    expect(structured(await call(reviewer.client, "drain_own_inbox")).messages).toEqual([]);
    const reply = structured(await call(reviewer.client, "update_work", { operation: "reply", reply_to_message_id: sent.message_id, content: "private reply", idempotency_key: "scripted-reply-1" }));
    expect(reply.delivery).toBe("queued_pull");
    expect(JSON.stringify(await call(builder.client, "drain_own_inbox"))).toContain("private reply");
    const db = new Database(paths.recorderDb, { readonly: true, fileMustExist: true });
    try { const ledger = JSON.stringify(db.prepare("SELECT * FROM invocations").all()); expect(ledger).not.toContain(secret); expect(ledger).not.toContain("private reply"); expect(ledger).not.toContain("scripted-prompt-1"); } finally { db.close(); }
  });

  it("rejects incompatible local-ipc endpoints and unsafe export paths before a mutation", async () => {
    // Upstream registerPullEndpoint preserves local-ipc; the fixed adapter must refuse it.
    const paths = fixture(); initializeLocalState(paths);
    const { client, runtime } = await clientFor(paths, "builder");
    await call(client, "register_pull_endpoint");
    const endpoint = runtime.repos.agentEndpoints.getByAgent("builder")!;
    runtime.repos.agentEndpoints.upsert({ ...endpoint, transport: "local-ipc", capabilities: ["local-ipc", "steer"], credentialHash: "scripted-test-only" });
    expect((await call(client, "register_pull_endpoint")).isError).toBe(true);
    runtime.repos.agentEndpoints.upsert({ ...endpoint, transport: "pull", capabilities: ["pull", "busy"], credentialHash: "scripted-test-only" });
    const target = join(paths.stateDir, "owned-target"); writeFileSync(target, "untouched");
    rmSync(join(paths.stateDir, "WORK_STATE.json"), { force: true }); symlinkSync(target, join(paths.stateDir, "WORK_STATE.json"));
    expect((await call(client, "start_work", { task_id: "unsafe", title: "Unsafe", kind: "codex" })).isError).toBe(true);
    expect(runtime.repos.tasks.get("unsafe")).toBeUndefined();
    expect(readFileSync(target, "utf8")).toBe("untouched");
    // Restore the intentionally unsafe fixture before owned runtime cleanup.
    rmSync(join(paths.stateDir, "WORK_STATE.json"));
  });

  it("does not expose the historical common-dir database to the isolated worker", async () => {
    // A stock root fallback would touch the older checkout's store.
    const historical = "/home/nur/Projects/archeagent-concord-hiring/.concord";
    expect(existsSync(historical)).toBe(false);
    const paths = fixture(); initializeLocalState(paths);
    const { client } = await clientFor(paths, "scripted-check");
    await call(client, "start_work", { task_id: "isolation", title: "Scripted isolation check", kind: "codex" });
    expect(existsSync(historical)).toBe(false);
  });

  it("reports committed database work as incomplete when export targets become unsafe after the commit", async () => {
    // Pretending an export failure rolled back the successful upstream handler would hide persisted work.
    const paths = fixture(); initializeLocalState(paths);
    const { client, runtime } = await clientFor(paths, "builder");
    const target = join(paths.stateDir, "owned-target"); writeFileSync(target, "untouched");
    runtime.repos.db.function("scripted_export_failure", () => { symlinkSync(target, join(paths.stateDir, "WORK_STATE.json")); return 1; });
    runtime.repos.db.exec("CREATE TRIGGER scripted_export_failure AFTER INSERT ON tasks BEGIN SELECT scripted_export_failure(); END");
    try {
      const result = await call(client, "start_work", { task_id: "committed", title: "Scripted export interruption", kind: "codex" });
      expect(result.isError).toBe(true);
      expect(structured(result).outcome).toBe("db_committed_export_failed");
      expect(runtime.repos.tasks.get("committed")?.agentId).toBe("builder");
      expect(readFileSync(target, "utf8")).toBe("untouched");
    } finally { rmSync(join(paths.stateDir, "WORK_STATE.json")); }
  });

  it("refreshes expired pull leases before another prompt can be queued", async () => {
    // Ignoring endpoint expiry would claim a vanished recipient is currently promptable.
    const paths = fixture(); initializeLocalState(paths);
    const builder = await clientFor(paths, "builder"); const reviewer = await clientFor(paths, "reviewer");
    await call(builder.client, "register_pull_endpoint"); await call(reviewer.client, "register_pull_endpoint");
    const endpoint = reviewer.runtime.repos.agentEndpoints.getByAgent("reviewer")!;
    reviewer.runtime.repos.agentEndpoints.upsert({ ...endpoint, credentialHash: "scripted-test-only", expiresAt: new Date(Date.now() - 60_000).toISOString() });
    const expired = await call(builder.client, "update_work", { operation: "prompt", to_agent_id: "reviewer", content: "Scripted expired lease check", idempotency_key: "expired-lease" });
    expect(expired.isError).toBe(true);
    const refreshed = structured(await call(reviewer.client, "register_pull_endpoint"));
    expect(Date.parse(refreshed.expires_at as string)).toBeGreaterThan(Date.now() + 80_000);
    const queued = structured(await call(builder.client, "update_work", { operation: "prompt", to_agent_id: "reviewer", content: "Scripted refreshed lease check", idempotency_key: "refreshed-lease" }));
    expect(queued.delivery).toBe("queued_pull");
  });

  it("denies another actor's private message thread and caps inbox drain before taking messages", async () => {
    // A participant guard or drain cap removed would disclose private bodies or mark unseen overflow delivered.
    const paths = fixture(); initializeLocalState(paths);
    const builder = await clientFor(paths, "builder"); const reviewer = await clientFor(paths, "reviewer"); const outsider = await clientFor(paths, "observer");
    await call(builder.client, "register_pull_endpoint"); await call(reviewer.client, "register_pull_endpoint");
    const sent = structured(await call(builder.client, "update_work", { operation: "prompt", to_agent_id: "reviewer", content: "PRIVATE_THREAD_SENTINEL", idempotency_key: "private-thread" }));
    const denied = await call(outsider.client, "inspect_work", { message_id: sent.message_id });
    expect(denied.isError).toBe(true); expect(JSON.stringify(denied)).not.toContain("PRIVATE_THREAD_SENTINEL");
    for (let i = 0; i < 100; i++) builder.runtime.repos.agentMessages.create({ messageId: randomUUID(), taskId: null, senderAgentId: "builder", recipientAgentId: "reviewer", replyToMessageId: null, content: "Scripted bounded-drain fixture", idempotencyKey: `bounded-${i}` });
    expect((await call(reviewer.client, "drain_own_inbox")).isError).toBe(true);
    expect(builder.runtime.repos.agentMessages.get(sent.message_id as string)?.status).toBe("pending");
  });

  it("provides executable help and rejects root selection without initializing production state", () => {
    // Launch arguments must never select a repository or start an uninitialized source as a fallback.
    for (const script of ["concord-local-mcp.ts", "concord-local-init.ts"]) {
      const output = execFileSync(process.execPath, ["--import", "tsx", join(resolveLocalPaths().rootDir, "scripts", script), "--help"], { cwd: resolveLocalPaths().rootDir, encoding: "utf8", timeout: 5000 });
      expect(output).toContain("fixed staging");
    }
    expect(() => execFileSync(process.execPath, ["--import", "tsx", "scripts/concord-local-mcp.ts", "--actor", "builder", "--root", "/forbidden"], { cwd: resolveLocalPaths().rootDir, timeout: 5000, stdio: "pipe" })).toThrow();
    expect(existsSync(resolveLocalPaths().sourceFile)).toBe(false);
    expect(existsSync(resolveLocalPaths().concordDb)).toBe(false);
  });

  it("rejects a private state directory readable by other users before initialization", () => {
    // Relaxing mode enforcement could expose source/auth/receipt state through a shared directory.
    const paths = fixture(); chmodSync(paths.stateDir, 0o755);
    try { expect(() => initializeLocalState(paths)).toThrow(); expect(existsSync(paths.concordDb)).toBe(false); }
    finally { chmodSync(paths.stateDir, 0o700); }
  });

  it("does not truncate a private leaf that gains a hardlink between validation and acquisition", () => {
    // The unavoidable file-open boundary double creates the OS race exactly;
    // the assertion checks real alias bytes, never calls to the double.
    const paths = fixture(); const filename = join(paths.stateDir, "flat-private"); const alias = join(paths.stateDir, "race-alias");
    writeFileSync(filename, "ORIGINAL_PRIVATE_SENTINEL");
    const originalOpen = fs.openSync;
    const spy = vi.spyOn(fs, "openSync").mockImplementation((path, flags, mode) => {
      if (path === filename && !existsSync(alias)) linkSync(filename, alias);
      return originalOpen(path, flags, mode);
    });
    syncBuiltinESMExports();
    try { expect(() => writePrivateFile(paths, filename, "replacement")).toThrow(); expect(readFileSync(alias, "utf8")).toBe("ORIGINAL_PRIVATE_SENTINEL"); }
    finally { spy.mockRestore(); syncBuiltinESMExports(); rmSync(alias, { force: true }); }
  });

  it("binds invocation record references to the writer lease rather than attributing a preceding writer's events", async () => {
    // Snapshotting before acquiring the cross-process lease attributes peer records to this actor.
    const paths = fixture(); initializeLocalState(paths);
    const builder = await clientFor(paths, "builder");
    const lock = join(paths.stateDir, "adapter-write.lock"); writeFileSync(lock, "scripted preceding writer lease", { mode: 0o600 });
    const pending = call(builder.client, "start_work", { task_id: "after-lock", title: "Scripted second writer", kind: "codex" });
    // Yield one event-loop turn so the genuine SDK request reaches its lease wait.
    await new Promise<void>(resolve => setImmediate(resolve));
    const preceding = handleStartWork(builder.runtime.repos, { task_id: "preceding", title: "Scripted preceding writer", kind: "codex", agent_id: "reviewer" });
    expect(preceding.claim.task.agentId).toBe("reviewer");
    rmSync(lock);
    expect((await pending).isError).not.toBe(true);
    const db = new Database(paths.recorderDb, { readonly: true, fileMustExist: true });
    try {
      const row = db.prepare("SELECT record_refs_json FROM invocations WHERE actor_id='builder' AND task_id='after-lock'").get() as { record_refs_json: string };
      expect(JSON.parse(row.record_refs_json).eventIds).toEqual([2]);
    } finally { db.close(); }
  });

  it.each(["symlink", "hardlink"])("preserves an owned target when a late %s appears at an export acquisition", async (kind) => {
    // A preflight-only guard rejects after a following path write has already
    // destroyed the aliased target. Inject at the genuine filesystem boundary.
    const paths = fixture(); initializeLocalState(paths);
    const { client, runtime } = await clientFor(paths, "builder");
    const output = join(paths.stateDir, "WORK_STATE.json"); const target = join(paths.stateDir, "owned-export-target");
    writeFileSync(target, "EXPORT_RACE_PRIVATE_TARGET_SENTINEL");
    let injected = false;
    const inject = (filename: unknown) => { if (filename === output && !injected) { injected = true; if (kind === "symlink") symlinkSync(target, output); else linkSync(target, output); } };
    const originalWrite = fs.writeFileSync, originalOpen = fs.openSync;
    const writeSpy = vi.spyOn(fs, "writeFileSync").mockImplementation((filename, data, options) => { inject(filename); return originalWrite(filename, data, options); });
    const openSpy = vi.spyOn(fs, "openSync").mockImplementation((filename, flags, mode) => { inject(filename); return originalOpen(filename, flags, mode); });
    syncBuiltinESMExports();
    try {
      const result = await call(client, "start_work", { task_id: "export-race", title: "Scripted export acquisition race", kind: "codex" });
      expect(injected).toBe(true); expect(result.isError).toBe(true);
      expect(readFileSync(target, "utf8")).toBe("EXPORT_RACE_PRIVATE_TARGET_SENTINEL");
      expect(structured(result).outcome).toBe("db_committed_export_failed");
      expect(runtime.repos.tasks.get("export-race")?.agentId).toBe("builder");
    } finally { writeSpy.mockRestore(); openSpy.mockRestore(); syncBuiltinESMExports(); rmSync(output, { force: true }); }
  });

  it("closes an acquired companion descriptor even when state becomes unsafe", () => {
    // Validation before descriptor cleanup leaks a live SQLite connection on a rejected source.
    const paths = fixture(); initializeLocalState(paths); const store = openPrivateStore(paths);
    const alias = join(paths.stateDir, "unsafe-lifecycle-alias"); symlinkSync(paths.sourceFile, alias);
    try { expect(() => store.close()).not.toThrow(); expect(store.db.open).toBe(false); }
    finally { rmSync(alias); if (store.db.open) store.db.close(); }
  });

  it("closes both SQLite descriptors when the external transport shutdown rejects", async () => {
    // Awaiting server.close before a finally block leaves both owned databases open on transport failure.
    const paths = fixture(); initializeLocalState(paths);
    let companion: Database.Database | undefined;
    const prepare = Database.prototype.prepare;
    const capture = vi.spyOn(Database.prototype, "prepare").mockImplementation(function(this: Database.Database, sql: string) {
      if (this.name === paths.recorderDb) {
        // eslint-disable-next-line @typescript-eslint/no-this-alias -- Observe the actual native descriptor to verify owned-resource cleanup.
        companion = this;
      }
      return prepare.call(this, sql);
    });
    const { runtime } = await clientFor(paths, "builder"); capture.mockRestore();
    const shutdown = vi.spyOn(runtime.server, "close").mockRejectedValue(new Error("Scripted transport shutdown failure"));
    try {
      await expect(runtime.close()).rejects.toThrow("Scripted transport shutdown failure");
      expect(runtime.repos.db.open).toBe(false); expect(companion?.open).toBe(false);
    } finally { shutdown.mockRestore(); await runtime.server.close(); if (companion?.open) companion.close(); if (runtime.repos.db.open) runtime.repos.db.close(); }
  });
});
