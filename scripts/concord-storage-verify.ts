#!/usr/bin/env -S node --import tsx
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, readdirSync, lstatSync, rmSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import Database from "better-sqlite3";
import { runIsolatedConcordCheck } from "../src/server/concord/isolated-process";
import { LOCAL_ROOT, resolveLocalPaths } from "../src/server/concord/local-paths";
import { parseIsolationProbeReceipt } from "../src/server/concord/isolation-receipt";

async function main() {
  if (process.argv.length > 2) throw new Error("Storage verifier accepts no options");
  const paths = resolveLocalPaths();
  for (const file of [paths.sourceFile, paths.concordDb, paths.recorderDb]) if (existsSync(file)) throw new Error("Real source must remain disabled");
  const audit = join(LOCAL_ROOT, ".local-audit");
  mkdirSync(audit, { recursive: true, mode: 0o700 });
  const witness = mkdtempSync(join(audit, "storage-witness-"));
  try {
    // Build a valid SQLite witness without opening a host disk-backed database.
    const seed = new Database(":memory:");
    let bytes: Buffer;
    try { seed.exec("CREATE TABLE outside_sentinel(value TEXT); INSERT INTO outside_sentinel VALUES('OWNED_OUTSIDE_TARGET_SENTINEL')"); bytes = seed.serialize(); }
    finally { seed.close(); }
    const target = join(witness, "present.sqlite");
    writeFileSync(target, bytes, { mode: 0o600 });
    const hash = (buffer: Buffer) => createHash("sha256").update(buffer).digest("hex");
    const before = lstatSync(target);
    const result = await runIsolatedConcordCheck("adversarial", witness.slice(LOCAL_ROOT.length + 1));
    const observed = lstatSync(target);
    if (result.exitCode !== 0 || hash(readFileSync(target)) !== hash(bytes) || before.ino !== observed.ino || before.size !== observed.size || before.mtimeMs !== observed.mtimeMs || readdirSync(witness).join() !== "present.sqlite") throw new Error("Host witness preservation failed");
    const receipt = parseIsolationProbeReceipt(result.stdout);
    for (const file of [paths.sourceFile, paths.concordDb, paths.recorderDb]) if (existsSync(file)) throw new Error("Real source unexpectedly enabled");
    process.stdout.write(JSON.stringify({ ...receipt, hostObserved: { targetHashBefore: hash(bytes), targetHashAfter: hash(readFileSync(target)), inodeUnchanged: before.ino === observed.ino, sizeUnchanged: before.size === observed.size, mtimeUnchanged: before.mtimeMs === observed.mtimeMs, outsideCreationAbsent: true }, storageBoundary: "PASS_EPHEMERAL_PROCESS", productStatus: "FAIL/HOLD", durablePersistenceVerified: false, realSourceEnabled: false }) + "\n");
  } finally { rmSync(witness, { recursive: true, force: true }); }
}
void main().catch(() => { process.stderr.write("Storage isolation verification failed; all real-source gates remain disabled.\n"); process.exitCode = 1; });
