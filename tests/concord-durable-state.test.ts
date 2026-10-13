import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, readFileSync, writeFileSync, readdirSync, symlinkSync, linkSync, lstatSync, renameSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { randomUUID, createHash, createHmac } from "node:crypto";
import Database from "better-sqlite3";
import { DurableConcordSupervisor, publisherArguments, type DurableReply } from "../src/server/concord/durable-supervisor";
import { LOCAL_ROOT } from "../src/server/concord/local-paths";

const fixtures: string[] = [], supervisors: DurableConcordSupervisor[] = [];
beforeAll(() => {
  const build = spawnSync(process.execPath, ["scripts/build-concord-persistence.mjs"], { cwd: LOCAL_ROOT, encoding: "utf8", timeout: 10000 });
  expect(build.status, build.stdout + build.stderr).toBe(0);
});
function fixture(): string {
  const parent = join(LOCAL_ROOT, ".concord/test-harness"); mkdirSync(parent, { recursive: true, mode: 0o700 });
  const dir = mkdtempSync(join(parent, "durable-store-")); fixtures.push(dir); return dir;
}
async function start(store = fixture(), initialize = true, minimumGeneration = 1) {
  const supervisor = await DurableConcordSupervisor.open(store, ["builder", "reviewer", "observer"], { initialize, minimumGeneration });
  supervisors.push(supervisor); return { supervisor, store };
}
function data(reply: DurableReply) { return (reply.result as { structuredContent: Record<string, unknown> }).structuredContent; }
afterEach(async () => {
  for (const supervisor of supervisors.splice(0)) await supervisor.close();
  for (const dir of fixtures.splice(0)) rmSync(dir, { recursive: true, force: true });
});
describe("durable confined Concord — actual process/storage fixtures, not model sessions", () => {
  it("smoke: persists committed WAL state and retrieves genuine records after a new worker", async () => {
    const { supervisor, store } = await start();
    const builder = supervisor.client("builder");
    const created = await builder.call("start_work", { task_id: "durable-build", title: "Scripted durable continuity", kind: "codex", expected_files: ["src/owned.ts"] });
    expect(created.acknowledgement.durable).toBe(true);
    const checkpoint = join(store, `${String(created.acknowledgement.generation).padStart(20, "0")}.snap`);
    expect(createHash("sha256").update(readFileSync(checkpoint)).digest("hex")).toBe(created.acknowledgement.checkpointDigest);
    expect(data(created).task_id).toBe("durable-build");
    await supervisor.restart();
    const recovered = await builder.call("inspect_work", { task_id: "durable-build" });
    expect(JSON.stringify(data(recovered))).toContain("durable-build");
    expect(recovered.acknowledgement.sourceInstanceId).toBe(created.acknowledgement.sourceInstanceId);
    expect(recovered.acknowledgement.generation).toBeGreaterThan(created.acknowledgement.generation);
  }, 30000);

  it("preserves conflict, ownership, handoff, events and addressed inbox privacy over repeated restart", async () => {
    const { supervisor } = await start(); const builder = supervisor.client("builder"), reviewer = supervisor.client("reviewer"), observer = supervisor.client("observer");
    const a = data(await builder.call("start_work", { task_id: "build", title: "Build", kind: "codex", expected_files: ["src/shared.ts"] }));
    const b = data(await reviewer.call("start_work", { task_id: "review", title: "Review", kind: "codex", expected_files: ["src/shared.ts"] }));
    expect((b.overlaps as unknown[]).length).toBe(1);
    const beforeRestart = await supervisor.auditMetadata();
    expect(beforeRestart.sourceRevision.eventId).toBeGreaterThan(0);
    // Upstream start_work does not fabricate a versioned transfer event.
    expect(beforeRestart.sourceRevision.ownershipEventId).toBe(0);
    await supervisor.restart();
    expect(await supervisor.auditMetadata()).toEqual(beforeRestart);
    expect(JSON.stringify(data(await builder.call("inspect_work", { task_id: "build" })))).toContain("src/shared.ts");
    await reviewer.call("transfer_work", { task_id: "review", action: "release", expected_version: b.version });
    const offer = data(await builder.call("transfer_work", { task_id: "build", action: "offer", expected_version: a.version, to_agent_id: "reviewer", what_changed: "Scripted restart handoff", changed_files: ["src/shared.ts"] }));
    await supervisor.restart();
    const accepted = data(await reviewer.call("transfer_work", { task_id: "build", action: "accept", expected_version: offer.version }));
    expect(accepted.agent_id).toBe("reviewer");
    const afterTransfer = await supervisor.auditMetadata();
    expect(afterTransfer.sourceRevision.ownershipEventId).toBeGreaterThan(0);
    expect(afterTransfer.sourceRevision.handoffId).toBeGreaterThan(0);
    await builder.call("register_pull_endpoint", {}); await reviewer.call("register_pull_endpoint", {});
    const sent = data(await builder.call("update_work", { operation: "prompt", to_agent_id: "reviewer", content: "SYNTHETIC_PRIVATE_MESSAGE", idempotency_key: "persist-private" }));
    await supervisor.restart();
    const denied = await observer.call("inspect_work", { message_id: sent.message_id });
    expect((denied.result as { isError: boolean }).isError).toBe(true);
    expect(JSON.stringify(denied)).not.toContain("SYNTHETIC_PRIVATE_MESSAGE");
    expect(JSON.stringify(data(await reviewer.call("drain_own_inbox", {})))).toContain("SYNTHETIC_PRIVATE_MESSAGE");
    await supervisor.restart();
    expect(data(await reviewer.call("drain_own_inbox", {})).messages).toEqual([]);
    const inspected = data(await reviewer.call("inspect_work", { task_id: "build" }));
    expect((inspected.ownership_history as unknown[]).length).toBeGreaterThan(1);
    const inspection = JSON.stringify(inspected);
    expect(inspection).toContain("reviewer"); expect(inspection).toContain("Scripted restart handoff");
  }, 30000);

  it("serializes competing clients, fences failed workers and deduplicates retries after lost acknowledgement", async () => {
    const { supervisor } = await start(); const builder = supervisor.client("builder"), reviewer = supervisor.client("reviewer");
    const results = await Promise.all([
      builder.call("start_work", { task_id: "a", title: "A", kind: "codex", expected_files: ["src/shared.ts"] }),
      reviewer.call("start_work", { task_id: "b", title: "B", kind: "codex", expected_files: ["src/shared.ts"] }),
    ]);
    expect((data(results[1]).overlaps as unknown[]).length).toBe(1);
    expect(results[1].acknowledgement.generation).toBe(results[0].acknowledgement.generation + 1);
    const id = randomUUID(); const args = { task_id: "retry", title: "Retry", kind: "codex" };
    const first = await builder.call("start_work", args, id); await supervisor.restart();
    const retry = await builder.call("start_work", args, id); expect(retry.result).toEqual(first.result);
    supervisor.terminateWorker(); await expect(builder.call("inspect_work", {})).rejects.toThrow();
    await supervisor.restart(); expect(JSON.stringify(data(await builder.call("inspect_work", { task_id: "retry" })))).toContain("retry");
    await expect(reviewer.call("start_work", args, id)).rejects.toThrow();
  }, 30000);

  it("can durably publish a fully captured committed state if the SQLite worker dies during checkpoint", async () => {
    const { supervisor } = await start(); const builder = supervisor.client("builder");
    supervisor.testBeforeCheckpoint(() => supervisor.terminateWorker());
    const captured = await builder.call("start_work", { task_id: "captured-before-death", title: "Captured", kind: "codex" });
    expect(captured.acknowledgement.durable).toBe(true);
    await expect(builder.call("inspect_work", {})).rejects.toThrow("held");
    await supervisor.restart();
    expect(JSON.stringify(data(await builder.call("inspect_work", { task_id: "captured-before-death" })))).toContain("captured-before-death");
  }, 30000);

  it("rejects malicious manifest fields and incompatible SQLite schema even in a fixture-authority-signed envelope", async () => {
    for (const malicious of ["manifest", "schema", "schema-prefix", "database-header"]) {
      const { supervisor, store } = await start(); await supervisor.close();
      const name = readdirSync(store).filter(file => file.endsWith(".snap")).sort().at(-1)!;
      const original = readFileSync(join(store, name));
      const payload = JSON.parse(original.subarray(52, original.length - 32).toString("utf8"));
      if (malicious === "manifest") payload.filename = "../../outside.sqlite";
      if (malicious === "schema") {
        const wrong = new Database(":memory:"); try { wrong.exec("PRAGMA user_version=11; CREATE TABLE malicious(value TEXT)"); payload.concord = wrong.serialize().toString("base64"); } finally { wrong.close(); }
      }
      if (malicious === "schema-prefix") {
        // SQLite reserves sqlite_, not sqlite plus any one character. A schema
        // LIKE wildcard must not hide an attacker-added lookalike object.
        const image = Buffer.from(payload.concord, "base64");
        image[18] = 1; image[19] = 1; // memory deserialize requires rollback-format header
        const modified = new Database(image);
        try { modified.exec("CREATE TABLE sqliteX_unapproved(value TEXT)"); payload.concord = modified.serialize().toString("base64"); }
        finally { modified.close(); }
      }
      if (malicious === "database-header") payload.concord = Buffer.from("not sqlite").toString("base64");
      const bytes = Buffer.from(JSON.stringify(payload)), header = Buffer.from(original.subarray(0, 52)); header.writeUInt32BE(bytes.length, 48);
      const message = Buffer.concat([header, bytes]);
      // This key is an owned test authority, never caller supplied in production.
      const tag = createHmac("sha256", readFileSync(join(store, "authority.key"))).update(message).digest();
      writeFileSync(join(store, name), Buffer.concat([message, tag]));
      let adopted: DurableConcordSupervisor | undefined, rejected = false;
      try {
        try { adopted = await DurableConcordSupervisor.open(store, ["builder"]); } catch { rejected = true; }
        expect(rejected, malicious).toBe(true);
      } finally { await adopted?.close(); }
    }
  }, 30000);

  it("requires the caller's remembered durability floor and rejects a second publisher for the same store", async () => {
    const { supervisor, store } = await start();
    await expect(DurableConcordSupervisor.open(store, ["builder"])).rejects.toThrow();
    const acknowledged = await supervisor.client("builder").call("start_work", { task_id: "floor", title: "Floor", kind: "codex" });
    await supervisor.close();
    rmSync(join(store, readdirSync(store).filter(name => name.endsWith(".snap")).sort().at(-1)!));
    await expect(DurableConcordSupervisor.open(store, ["builder"], { minimumGeneration: acknowledged.acknowledgement.generation })).rejects.toThrow("Rollback");
  }, 30000);

  it("keeps publisher exclusion on the directory inode after a late lock-file replacement", async () => {
    const { supervisor, store } = await start();
    await supervisor.client("builder").call("start_work", { task_id: "pinned-owner", title: "Pinned owner", kind: "codex" });
    rmSync(join(store, "owner.lock"));
    writeFileSync(join(store, "owner.lock"), "", { mode: 0o600, flag: "wx" });
    let competing: DurableConcordSupervisor | undefined;
    let rejected = false;
    try {
      try { competing = await DurableConcordSupervisor.open(store, ["builder"]); } catch { rejected = true; }
      expect(rejected).toBe(true);
    } finally { await competing?.close(); }
    const acknowledged = await supervisor.client("builder").call("inspect_work", { task_id: "pinned-owner" });
    expect(acknowledged.acknowledgement.durable).toBe(true);
  }, 30000);

  it("makes restart a serialized barrier for already-admitted and immediately following requests", async () => {
    const { supervisor } = await start(); const builder = supervisor.client("builder");
    const before = builder.call("start_work", { task_id: "before-barrier", title: "Before barrier", kind: "codex" });
    const restart = supervisor.restart();
    const after = builder.call("start_work", { task_id: "after-barrier", title: "After barrier", kind: "codex" });
    const results = await Promise.allSettled([before, restart, after]);
    expect(results.map(result => result.status)).toEqual(["fulfilled", "fulfilled", "fulfilled"]);
    const recovered = await builder.call("inspect_work", { task_id: "after-barrier" });
    expect(data(recovered).task).toMatchObject({ taskId: "after-barrier" });
  }, 30000);

  it("keeps close terminal instead of resurrecting a worker through restart", async () => {
    const { supervisor } = await start(); const builder = supervisor.client("builder");
    await supervisor.close();
    await expect(supervisor.restart()).rejects.toThrow("closed");
    await expect(builder.call("inspect_work", {})).rejects.toThrow("closed");
  }, 30000);

  it("keeps restart bound to its originally acquired store inode without initializing a substituted directory", async () => {
    const { supervisor, store } = await start();
    await supervisor.client("builder").call("start_work", { task_id: "before-store-move", title: "Before store move", kind: "codex" });
    const retained = `${store}-retained`; fixtures.push(retained);
    renameSync(store, retained); mkdirSync(store, { mode: 0o700 });
    // Existing publisher holds the original descriptor mount, never the new path.
    const captured = await supervisor.client("builder").call("inspect_work", { task_id: "before-store-move" });
    expect(captured.acknowledgement.durable).toBe(true);
    expect(readdirSync(store)).toEqual([]);
    const retainedNames = readdirSync(retained).sort();
    await expect(supervisor.restart()).rejects.toThrow();
    // Refusal must precede even new key/lock creation in the substituted inode.
    expect(readdirSync(store)).toEqual([]);
    expect(readdirSync(retained).sort()).toEqual(retainedNames);
    await expect(supervisor.client("builder").call("inspect_work", {})).rejects.toThrow("held");
  }, 30000);

  it.each([1, 2, 3] as const)("does not ACK interrupted publisher stage %i and recovers safely for idempotent retry", async stage => {
    const { supervisor } = await start(); const builder = supervisor.client("builder");
    await builder.call("start_work", { task_id: "before-crash", title: "Before", kind: "codex" });
    let observed = false; await supervisor.testPublisherCrash(stage, () => { observed = true; });
    const id = randomUUID(), args = { task_id: "interrupted", title: "Interrupted", kind: "codex" };
    await expect(builder.call("start_work", args, id)).rejects.toThrow("unacknowledged"); expect(observed).toBe(true);
    await supervisor.restart();
    const retry = await builder.call("start_work", args, id); expect(data(retry).task_id).toBe("interrupted");
    expect(JSON.stringify(data(await builder.call("inspect_work", { task_id: "before-crash" })))).toContain("before-crash");
  }, 30000);

  it("refuses corrupt/truncated newest generations rather than rolling back to earlier valid state", async () => {
    for (const corruption of ["truncated", "altered", "gap"]) {
      const { supervisor, store } = await start();
      await supervisor.client("builder").call("start_work", { task_id: "must-not-lose", title: "Must not lose", kind: "codex" }); await supervisor.close();
      const generations = readdirSync(store).filter(name => name.endsWith(".snap")).sort(); const target = join(store, generations.at(-1)!);
      if (corruption === "gap") rmSync(join(store, generations[0]));
      else { const bytes = readFileSync(target); if (corruption === "altered") bytes[60] ^= 1; writeFileSync(target, corruption === "truncated" ? bytes.subarray(0, 64) : bytes); }
      await expect(DurableConcordSupervisor.open(store, ["builder"])).rejects.toThrow();
    }
  }, 30000);

  it("rejects persistent snapshot/key symlinks, hardlinks, traversal and caller-selected actors without modifying outside witnesses", async () => {
    const outside = mkdtempSync(join(LOCAL_ROOT, ".local-audit", "durable-outside-")); fixtures.push(outside);
    const sentinel = join(outside, "sentinel"); writeFileSync(sentinel, "SYNTHETIC_OUTSIDE_SENTINEL", { mode: 0o600 });
    const hash = () => createHash("sha256").update(readFileSync(sentinel)).digest("hex"); const before = hash(), stat = lstatSync(sentinel);
    for (const entry of ["authority.key", "00000000000000000001.snap", "owner.lock"]) {
      for (const kind of ["symlink", "hardlink"]) {
        const store = fixture(); if (kind === "symlink") symlinkSync(sentinel, join(store, entry)); else linkSync(sentinel, join(store, entry));
        await expect(DurableConcordSupervisor.open(store, ["builder"])).rejects.toThrow();
        expect(hash()).toBe(before); expect(lstatSync(sentinel).mtimeMs).toBe(stat.mtimeMs);
      }
    }
    await expect(DurableConcordSupervisor.open(`${outside}/../invalid`, ["builder"])).rejects.toThrow();
    const { supervisor } = await start(); expect(() => supervisor.client("unregistered")).toThrow();
    const denied = await supervisor.client("builder").call("start_work", { task_id: "invalid", title: "Invalid", agent_id: "reviewer", kind: "codex" });
    expect((denied.result as { isError: boolean }).isError).toBe(true);
    await expect(supervisor.client("builder").call("start_work", { title: "x".repeat(70000) })).rejects.toThrow();
    expect(hash()).toBe(before);
  }, 30000);

  it("rejects late next-generation aliases after preflight without altering or creating outside targets", async () => {
    const outside = mkdtempSync(join(LOCAL_ROOT, ".local-audit", "durable-late-outside-")); fixtures.push(outside);
    const sentinel = join(outside, "sentinel"), absent = join(outside, "absent");
    writeFileSync(sentinel, "LATE_ALIAS_SYNTHETIC_SENTINEL", { mode: 0o600 });
    const bytes = readFileSync(sentinel), before = lstatSync(sentinel);
    for (const kind of ["existing-symlink", "absent-symlink", "hardlink"]) {
      const { supervisor, store } = await start();
      supervisor.testBeforeCheckpoint(() => {
        const name = join(store, "00000000000000000002.snap");
        if (kind === "hardlink") linkSync(sentinel, name);
        else symlinkSync(kind === "absent-symlink" ? absent : sentinel, name);
      });
      await expect(supervisor.client("builder").call("start_work", { task_id: "late-alias", title: "Late", kind: "codex" })).rejects.toThrow("unacknowledged");
      await supervisor.close();
      expect(readFileSync(sentinel)).toEqual(bytes);
      expect(lstatSync(sentinel).mtimeMs).toBe(before.mtimeMs);
      expect(readdirSync(outside)).toEqual(["sentinel"]);
    }
  }, 30000);
  it("rejects late store-directory symlink/replacement between validation and descriptor acquisition", () => {
    for (const substitution of ["symlink", "directory"]) {
      const store = fixture(), args = publisherArguments(store), original = `${store}-original`; fixtures.push(original);
      renameSync(store, original);
      const outside = mkdtempSync(join(LOCAL_ROOT, ".local-audit", "durable-mount-outside-")); fixtures.push(outside);
      writeFileSync(join(outside, "sentinel"), "OWNED_SENTINEL", { mode: 0o600 });
      if (substitution === "symlink") symlinkSync(outside, store); else mkdirSync(store, { mode: 0o700 });
      const result = spawnSync(join(LOCAL_ROOT, ".local-audit/native-persistence/launcher"), args, { input: Buffer.from([0, 0, 0, 1, 0]), timeout: 5000 });
      expect(result.status).toBe(1); expect(readdirSync(outside)).toEqual(["sentinel"]); expect(readdirSync(original)).toEqual([]);
    }
  });
});
