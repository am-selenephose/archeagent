import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, lstatSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, readdirSync, symlinkSync } from "node:fs";
import Database from "better-sqlite3";
import { openRepositories } from "@concord-ai/concord-mcp/dist/db/index.js";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { assertSqliteProcessBoundary } from "../src/server/concord/sqlite-confinement";
import { runIsolatedConcordCheck } from "../src/server/concord/isolated-process";
import { resolveLocalPaths } from "../src/server/concord/local-paths";
import { SQLITE_PROBE_CHECKS, parseIsolationProbeReceipt } from "../src/server/concord/isolation-receipt";

const root = "/home/nur/Projects/archeagent-final-staging";
describe("SQLite isolation independently observed from the host", () => {
  it("detects the unsafe stock acquisition as a negative control using only owned disposable files", () => {
    mkdirSync(join(root, ".local-audit"), { recursive: true, mode: 0o700 });
    const control = mkdtempSync(join(root, ".local-audit", "unsafe-control-"));
    const link = join(control, "unprotected.sqlite");
    const target = join(control, "outside-target.sqlite");
    // This direct stock factory is deliberately outside the protected runtime;
    // it demonstrates the oracle would detect the old escape, not real activity.
    try {
      expect(existsSync(target)).toBe(false);
      symlinkSync(target, link);
      const repos = openRepositories(link);
      try { expect(repos.db.pragma("user_version", { simple: true })).toBe(11); }
      finally { repos.db.close(); }
      expect(existsSync(target)).toBe(true);
      expect(readFileSync(target).subarray(0, 16).toString()).toBe("SQLite format 3\u0000");
    } finally { rmSync(control, { recursive: true, force: true }); }
  });
  it("refuses host acquisition regardless of caller environment assertions", () => {
    const previous = process.env.ARCHEAGENT_SQLITE_ISOLATED;
    process.env.ARCHEAGENT_SQLITE_ISOLATED = "true";
    try { expect(() => assertSqliteProcessBoundary(resolveLocalPaths())).toThrow("SQLite process confinement unavailable"); }
    finally { if (previous === undefined) delete process.env.ARCHEAGENT_SQLITE_ISOLATED; else process.env.ARCHEAGENT_SQLITE_ISOLATED = previous; }
  });
  it("rejects an unknown program instead of accepting an arbitrary executable/argv", async () => {
    await expect(runIsolatedConcordCheck("caller-program" as "adversarial", "invalid")).rejects.toThrow();
  });
  it("rejects omitted, duplicated, failing or contradictory scripted check receipts", () => {
    const valid = { version: "archeagent.sqlite-isolation-probe.v1", provenance: "scripted_protocol_test", storage: "kernel_private_tmpfs", durablePersistence: false, realSourceEnabled: false, checks: SQLITE_PROBE_CHECKS.map(name => ({ name, passed: true })) };
    expect(parseIsolationProbeReceipt(JSON.stringify(valid)).checks).toHaveLength(SQLITE_PROBE_CHECKS.length);
    for (const invalid of [
      { ...valid, checks: valid.checks.slice(0, -1) },
      { ...valid, checks: valid.checks.map(() => valid.checks[0]) },
      { ...valid, checks: valid.checks.map((check, index) => index ? check : { ...check, passed: false }) },
      { ...valid, provenance: "genuine_codex_session" },
      { ...valid, durablePersistence: true },
      { ...valid, realSourceEnabled: true },
    ]) expect(() => parseIsolationProbeReceipt(JSON.stringify(invalid))).toThrow("Incomplete storage probe receipt");
  });
  it("runs real SQLite attack probes without creating or modifying any outside host target", async () => {
    mkdirSync(join(root, ".local-audit"), { recursive: true, mode: 0o700 });
    const dir = mkdtempSync(join(root, ".local-audit", "storage-witness-"));
    const present = join(dir, "present.sqlite");
    const absent = join(dir, "absent.sqlite");
    const seed = new Database(":memory:");
    seed.exec("CREATE TABLE outside_sentinel(value TEXT); INSERT INTO outside_sentinel VALUES('OWNED_OUTSIDE_TARGET_SENTINEL')");
    const expected = seed.serialize(); seed.close();
    writeFileSync(present, expected, { mode: 0o600 });
    const before = { hash: createHash("sha256").update(readFileSync(present)).digest("hex"), stat: lstatSync(present), names: readdirSync(dir).sort() };
    try {
      const result = await runIsolatedConcordCheck("adversarial", dir.slice(root.length + 1));
      expect(result.exitCode, result.stderr).toBe(0);
      const receipt = parseIsolationProbeReceipt(result.stdout);
      expect(receipt.version).toBe("archeagent.sqlite-isolation-probe.v1");
      expect(receipt.provenance).toBe("scripted_protocol_test");
      expect(receipt.checks.map(check => check.name)).toEqual([...SQLITE_PROBE_CHECKS]);
      for (const check of receipt.checks) expect(check.passed, check.name).toBe(true);
      expect(readFileSync(present)).toEqual(expected);
      expect(createHash("sha256").update(readFileSync(present)).digest("hex")).toBe(before.hash);
      const after = lstatSync(present);
      expect({ ino: after.ino, size: after.size, mtime: after.mtimeMs }).toEqual({ ino: before.stat.ino, size: before.stat.size, mtime: before.stat.mtimeMs });
      expect(existsSync(absent)).toBe(false);
      expect(readdirSync(dir).sort()).toEqual(before.names);
      expect(existsSync(join(root, ".concord", "concord.sqlite"))).toBe(false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 60000);
});
