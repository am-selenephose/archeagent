/** Independent scripted attack driver. No models, production state or caller SQL. */
import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { randomUUID } from "node:crypto";
import { join, relative } from "node:path";
import Database from "better-sqlite3";
import { execFileSync } from "node:child_process";
import { initializeLocalState, openLocalRuntime } from "../src/server/concord/local-runtime";
import { openConfinedDatabase, openConfinedConcordRepositories } from "../src/server/concord/confined-database";
import { assertSqliteProcessBoundary } from "../src/server/concord/sqlite-confinement";
import { LOCAL_ROOT, resolveLocalPaths, type LocalPaths } from "../src/server/concord/local-paths";
import { parseIsolationProbeReceipt } from "../src/server/concord/isolation-receipt";

const witness = process.argv[2];
if (!/^\.local-audit\/storage-witness-[a-zA-Z0-9]+$/.test(witness ?? "")) throw new Error("Probe unavailable");
const outside = join(LOCAL_ROOT, witness);
const present = join(outside, "present.sqlite");
const absent = join(outside, "absent.sqlite");
const checks: { name: string; passed: boolean }[] = [];
const scopes: string[] = [];
function scope(): LocalPaths {
  const stateDir = join(LOCAL_ROOT, ".concord", "test-harness", `probe-${randomUUID()}`);
  fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 }); scopes.push(stateDir);
  return { rootDir: LOCAL_ROOT, stateDir, concordDb: join(stateDir, "concord.sqlite"), recorderDb: join(stateDir, "recorder.sqlite"), sourceFile: join(stateDir, "source.json") };
}
function check(name: string, run: () => void) { run(); checks.push({ name, passed: true }); }

async function main() {
  assertSqliteProcessBoundary(resolveLocalPaths());
  const expected = fs.readFileSync(present);
  const names = fs.readdirSync(outside).sort();
  const unchanged = () => {
    assert.deepEqual(fs.readFileSync(present), expected);
    assert.equal(fs.existsSync(absent), false);
    assert.deepEqual(fs.readdirSync(outside).sort(), names);
  };
  check("kernel-private-state-and-readonly-host", () => assertSqliteProcessBoundary(resolveLocalPaths()));
  check("real-source-initializer-still-held", () => assert.throws(() => initializeLocalState(), /isolation gate is held/));
  check("nested-user-or-mount-namespace-creation-is-disabled", () => {
    assert.throws(() => execFileSync("/usr/bin/unshare", ["--user", "--mount", "/usr/bin/true"], { stdio: "pipe", timeout: 5000 }));
  });
  check("outside-direct-open-or-migration-is-denied-by-kernel", () => {
    for (const filename of [present, absent]) {
      let db: Database.Database | undefined;
      assert.throws(() => { db = new Database(filename); db.exec("CREATE TABLE escape_attempt(value TEXT)"); });
      db?.close(); unchanged();
    }
  });
  check("proc-root-and-borrowed-directory-descriptor-aliases-cannot-write-host-targets", () => {
    const roots = ["/proc/self/root", "/proc/1/root", "/proc/self/cwd", "/proc/1/cwd"];
    let attempted = 0;
    // Include any visible directory descriptors retained by the namespace
    // reaper, not just /proc/self/fd. Permission-denied entries expose no path.
    for (const pid of fs.readdirSync("/proc").filter(name => /^[0-9]+$/.test(name)).slice(0, 32)) {
      let fds: string[];
      try { fds = fs.readdirSync(`/proc/${pid}/fd`); } catch { continue; }
      for (const fd of fds.slice(0, 64)) {
        const filename = `/proc/${pid}/fd/${fd}`;
        try { if (fs.statSync(filename).isDirectory()) roots.push(filename); } catch { /* Unavailable descriptors cannot be acquired. */ }
      }
    }
    const borrowed = fs.openSync(present, fs.constants.O_RDONLY);
    try {
      for (const alias of roots) {
        let destination: string;
        try { destination = fs.realpathSync(alias); } catch { continue; }
        for (const target of [present, absent]) {
          // Do not normalize the .. segments away from the proc alias.
          const filename = `${alias}/${relative(destination, target)}`;
          let db: Database.Database | undefined;
          try { assert.throws(() => { db = new Database(filename); db.exec("CREATE TABLE proc_escape(value TEXT)"); }); }
          finally { db?.close(); }
          attempted++; unchanged();
        }
      }
      let db: Database.Database | undefined;
      try { assert.throws(() => { db = new Database(`/proc/self/fd/${borrowed}`); db.exec("CREATE TABLE fd_escape(value TEXT)"); }); }
      finally { db?.close(); }
      assert.ok(attempted >= 2); unchanged();
    } finally { fs.closeSync(borrowed); }
  });

  // No path guard is used by these direct SQLite opens. The mount boundary,
  // not a mocked validator, must preserve the real outside targets.
  for (const target of [present, absent]) {
    check(`late-main-alias-${target === present ? "existing" : "absent"}`, () => {
      const paths = scope();
      const originalExists = fs.existsSync;
      let injected = false;
      fs.existsSync = ((filename) => {
        if (filename === paths.stateDir && !injected) { injected = true; fs.symlinkSync(target, paths.concordDb); }
        return originalExists(filename);
      }) as typeof fs.existsSync;
      syncBuiltinESMExports();
      try { assert.throws(() => openConfinedConcordRepositories(paths)); assert.equal(injected, true); unchanged(); }
      finally { fs.existsSync = originalExists; syncBuiltinESMExports(); }
    });
  }
  for (const sidecar of ["-wal", "-shm", "-journal"]) {
    for (const target of [present, absent]) {
      check(`sqlite-sidecar-alias-${sidecar}-${target === present ? "existing" : "absent"}`, () => {
        const paths = scope();
        const seed = new Database(paths.concordDb);
        try { seed.exec("CREATE TABLE seed(value TEXT)"); } finally { seed.close(); }
        fs.symlinkSync(target, `${paths.concordDb}${sidecar}`);
        let db: Database.Database | undefined;
        try {
          db = new Database(paths.concordDb);
          if (sidecar === "-journal") db.pragma("journal_mode = DELETE"); else db.pragma("journal_mode = WAL");
          db.exec("INSERT INTO seed VALUES('should never damage outside target')");
        } catch { /* Refusal is expected; outside effects are checked independently. */ }
        finally { db?.close(); }
        unchanged();
      });
    }
  }
  check("hardlinks-cannot-import-host-inodes-into-private-state", () => {
    const paths = scope();
    for (const suffix of ["", "-wal", "-shm", "-journal"]) assert.throws(() => fs.linkSync(present, `${paths.concordDb}${suffix}`));
    unchanged();
  });
  check("late-directory-alias-cannot-create-a-host-database", () => {
    const paths = scope();
    const originalExists = fs.existsSync;
    let injected = false;
    fs.existsSync = ((filename) => {
      if (filename === paths.stateDir && !injected) { injected = true; fs.renameSync(paths.stateDir, `${paths.stateDir}-original`); scopes.push(`${paths.stateDir}-original`); fs.symlinkSync(outside, paths.stateDir); }
      return originalExists(filename);
    }) as typeof fs.existsSync;
    syncBuiltinESMExports();
    try { assert.throws(() => openConfinedConcordRepositories(paths)); assert.equal(injected, true); unchanged(); }
    finally { fs.existsSync = originalExists; syncBuiltinESMExports(); }
  });
  check("mounted-state-ancestor-cannot-be-reparented-or-substituted", () => {
    assert.throws(() => fs.renameSync(join(LOCAL_ROOT, ".concord"), join(outside, "moved-state")));
    assert.throws(() => fs.symlinkSync(outside, join(LOCAL_ROOT, ".concord")));
    unchanged(); assertSqliteProcessBoundary(resolveLocalPaths());
  });
  check("genuine-Concord-schema-constraints-and-active-WAL-snapshots", () => {
    const paths = scope(); const repos = openConfinedConcordRepositories(paths);
    const reader = openConfinedDatabase(paths, "concord", { readonly: true, fileMustExist: true });
    try {
      assert.equal(repos.db.pragma("user_version", { simple: true }), 11);
      assert.equal(repos.db.pragma("journal_mode", { simple: true }), "wal");
      repos.db.pragma("wal_autocheckpoint = 0");
      repos.db.exec("CREATE TABLE snapshot_probe(value INTEGER)");
      repos.db.exec("INSERT INTO snapshot_probe VALUES(1)");
      reader.exec("BEGIN"); assert.equal((reader.prepare("SELECT COUNT(*) count FROM snapshot_probe").get() as { count: number }).count, 1);
      repos.db.exec("INSERT INTO snapshot_probe VALUES(2)");
      assert.equal((reader.prepare("SELECT COUNT(*) count FROM snapshot_probe").get() as { count: number }).count, 1);
      reader.exec("COMMIT"); assert.equal((reader.prepare("SELECT COUNT(*) count FROM snapshot_probe").get() as { count: number }).count, 2);
      assert.equal(fs.existsSync(`${paths.concordDb}-wal`), true); assert.equal(fs.existsSync(`${paths.concordDb}-shm`), true);
      assert.throws(() => reader.exec("INSERT INTO snapshot_probe VALUES(3)"));
      assert.throws(() => repos.db.exec("INSERT INTO task_updates(task_id,kind,content,created_at) VALUES('missing','note','x','2026-10-13T00:00:00Z')"));
      unchanged();
    } finally { reader.close(); repos.db.close(); }
  });
  check("active-WAL-cannot-gain-an-outside-hardlink", () => {
    const paths = scope(); const repos = openConfinedConcordRepositories(paths);
    try {
      repos.db.exec("CREATE TABLE active_probe(value INTEGER); INSERT INTO active_probe VALUES(1)");
      for (const suffix of ["", "-wal", "-shm"]) assert.throws(() => fs.linkSync(`${paths.concordDb}${suffix}`, join(outside, `active${suffix}.sqlite`)));
      repos.db.exec("INSERT INTO active_probe VALUES(2)");
      repos.db.pragma("wal_checkpoint(TRUNCATE)"); unchanged();
    } finally { repos.db.close(); }
  });
  for (const sidecar of ["wal", "shm"]) {
    for (const target of [present, absent]) {
      check(`active-${sidecar}-substitution-and-checkpoint-preserve-host-${target === present ? "existing" : "absent"}`, () => {
        const paths = scope(); const writer = new Database(paths.concordDb);
        let reader: Database.Database | undefined;
        try {
          writer.pragma("journal_mode = WAL"); writer.pragma("wal_autocheckpoint = 0");
          writer.exec("CREATE TABLE active_probe(value INTEGER); INSERT INTO active_probe VALUES(1)");
          fs.renameSync(`${paths.concordDb}-${sidecar}`, `${paths.concordDb}-${sidecar}-original`);
          fs.symlinkSync(target, `${paths.concordDb}-${sidecar}`);
          try { reader = new Database(paths.concordDb); reader.prepare("SELECT * FROM active_probe").all(); } catch { /* May reject a replaced WAL/index. */ }
          try { writer.exec("INSERT INTO active_probe VALUES(2)"); writer.pragma("wal_checkpoint(TRUNCATE)"); } catch { /* May reject inode drift. */ }
          unchanged();
        } finally { reader?.close(); writer.close(); unchanged(); }
      });
    }
  }
  check("cleanup-after-main-alias-substitution-cannot-touch-outside-target", () => {
    const paths = scope(); const db = new Database(paths.concordDb);
    db.pragma("journal_mode = WAL"); db.exec("CREATE TABLE cleanup_probe(value INTEGER); INSERT INTO cleanup_probe VALUES(1)");
    fs.renameSync(paths.concordDb, `${paths.concordDb}-original`); fs.symlinkSync(present, paths.concordDb);
    db.close(); assert.equal(db.open, false); unchanged();
  });
  check("runtime-acquisition-preserves-scope-and-rejects-foreign-run", () => {
    const paths = scope(); initializeLocalState(paths);
    assert.throws(() => openLocalRuntime("test-builder", randomUUID(), paths)); unchanged();
  });
  check("vacuum-into-cannot-create-an-outside-database", () => {
    const paths = scope(); const db = new Database(paths.concordDb);
    try {
      db.exec("CREATE TABLE backup_probe(value INTEGER); INSERT INTO backup_probe VALUES(1)");
      assert.throws(() => db.exec(`VACUUM INTO '${absent.replaceAll("'", "''")}'`));
      unchanged();
    } finally { db.close(); }
  });
  for (const dir of scopes) fs.rmSync(dir, { recursive: true, force: true });
  const output = JSON.stringify({ version: "archeagent.sqlite-isolation-probe.v1", provenance: "scripted_protocol_test", storage: "kernel_private_tmpfs", durablePersistence: false, realSourceEnabled: false, checks });
  parseIsolationProbeReceipt(output);
  process.stdout.write(output + "\n");
}
void main().catch(() => { process.stderr.write("SQLite isolation probe failed; real-source gate remains held.\n"); process.exitCode = 1; });
