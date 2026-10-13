/** Finite parent-owned verification. Owned fixtures only; never production URLs. */
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, rmSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
const root = "/home/nur/Projects/archeagent-final-staging";
if (process.argv.length !== 2 || process.cwd() !== root) throw new Error("Verification scope rejected");
const audit = join(root, ".local-audit"); mkdirSync(audit, { recursive: true, mode: 0o700 });
const output = mkdtempSync(join(audit, "durable-verification-"));
const runId = randomUUID().slice(0, 8), label = `archeagent-durability-${runId}`;
const containers = [], fixtures = [], receipts = [];
const font = join(root, "public/fonts/axuno-original-demo.otf");
const fingerprint = () => createHash("sha256").update(readFileSync(font)).digest("hex");
const beforeFont = fingerprint();
function run(name, executable, args, options = {}) {
  const result = spawnSync(executable, args, { cwd: root, env: { ...process.env, ...options.env }, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 180000, ...options });
  writeFileSync(join(output, `${name}.log`), (result.stdout ?? "") + (result.stderr ?? ""), { mode: 0o600 });
  receipts.push({ name, executable, args, cwd: options.cwd ?? root, exitCode: result.status, signal: result.signal, error: result.error?.message ?? null });
  if (result.status !== 0 || result.error) throw new Error(`${name} failed`);
  return result.stdout;
}
function docker(args) {
  const result = spawnSync("docker", args, { encoding: "utf8", timeout: 30000 });
  if (result.status !== 0) throw new Error("Owned test service operation failed");
  return result.stdout.trim();
}
async function ready(id, args) {
  for (let attempts = 0; attempts < 40; attempts++) {
    const result = spawnSync("docker", ["exec", id, ...args], { encoding: "utf8", timeout: 2000 });
    if (result.status === 0) return;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error("Owned service readiness failed");
}
let status = "FAIL", failure = null;
try {
  for (const filename of ["source.json", "concord.sqlite", "recorder.sqlite"]) if (existsSync(join(root, ".concord", filename))) throw new Error("Real source gate must remain held");
  run("native-build", process.execPath, ["scripts/build-concord-persistence.mjs"]);
  run("isolation-25", process.execPath, ["--import", "tsx", "scripts/concord-storage-verify.ts"]);
  run("focused", "pnpm", ["exec", "vitest", "run", "tests/concord-durable-state.test.ts", "tests/concord-durable-ipc.test.ts", "tests/concord-sqlite-confinement.test.ts", "tests/concord-local-adapter.test.ts"]);
  const store = mkdtempSync(join(root, ".concord/test-harness/durable-store-")); fixtures.push(store);
  const suffix = store.split("/").at(-1), witness = join(audit, `${suffix}.receipt.json`); fixtures.push(witness);
  run("fresh-parent-seed", process.execPath, ["--import", "tsx", "scripts/concord-durable-fixture.ts", "seed", suffix]);
  run("fresh-parent-recovery", process.execPath, ["--import", "tsx", "scripts/concord-durable-fixture.ts", "recover", suffix]);

  const pg = docker(["run", "-d", "--rm", "--pull", "never", "--name", `${label}-pg`, "--label", `codex.audit=${label}`, "--tmpfs", "/var/lib/postgresql/data", "-p", "127.0.0.1:25469:5432", "-e", "POSTGRES_USER=archeagent_test", "-e", "POSTGRES_PASSWORD=archeagent_local_test_only", "-e", "POSTGRES_DB=archeagent_test", "postgres:16-alpine"]); containers.push(pg);
  const redis = docker(["run", "-d", "--rm", "--pull", "never", "--name", `${label}-redis`, "--label", `codex.audit=${label}`, "--tmpfs", "/data", "-p", "127.0.0.1:26379:6379", "redis:7-alpine"]); containers.push(redis);
  await ready(pg, ["pg_isready", "-U", "archeagent_test", "-d", "archeagent_test"]); await ready(redis, ["redis-cli", "ping"]);
  run("full-tests", "pnpm", ["test"], { env: { ...process.env, ARCHEAGENT_TEST_DATABASE_URL: "postgres://archeagent_test:archeagent_local_test_only@127.0.0.1:25469/archeagent_test", ARCHEAGENT_TEST_REDIS_URL: "redis://127.0.0.1:26379/15" } });
  run("typescript", "pnpm", ["exec", "tsc", "--noEmit", "--incremental", "false"]);
  run("lint", "pnpm", ["lint"]);
  run("production-build", "pnpm", ["build"], { env: { ...process.env, ARCHEAGENT_LOCAL_BUILD: "completion" } });
  run("go-race", "go", ["test", "-race", "-count=1", "-json", "./..."], { cwd: join(root, "services/executor-go") });
  run("go-vet", "go", ["vet", "./..."], { cwd: join(root, "services/executor-go") });
  run("go-modules", "go", ["mod", "verify"], { cwd: join(root, "services/executor-go") });
  run("tracked-whitespace", "git", ["diff", "--check"]);
  if (fingerprint() !== beforeFont) throw new Error("Private font changed");
  for (const filename of ["source.json", "concord.sqlite", "recorder.sqlite"]) if (existsSync(join(root, ".concord", filename))) throw new Error("Real source unexpectedly enabled");
  status = "PASS_LOCAL_EXECUTED_GATES";
} catch (error) { failure = error.message; }
finally {
  for (const id of containers) {
    try {
      const actual = docker(["inspect", "--format", '{{index .Config.Labels "codex.audit"}}', id]);
      if (actual !== label) throw new Error("Refusing unrelated container cleanup");
      docker(["stop", id]);
    } catch { status = "FAIL"; failure ??= "Owned test service cleanup failed"; }
  }
  for (const fixture of fixtures) rmSync(fixture, { recursive: true, force: true });
  const receipt = { version: "archeagent.durability-verification.v1", provenance: "scripted_protocol_test", status, productStatus: "FAIL/HOLD", failure, output, receipts, fixtureServices: { ownedLabel: label, containerIds: containers, postgresPort: 25469, redisPort: 26379, cleanupAttempted: true }, fontUnchanged: fingerprint() === beforeFont, remainingHarnessNames: readdirSync(join(root, ".concord/test-harness")), realSourceEnabled: false, independentExternalReview: false, hardwarePowerLossTested: false, releaseAuthorized: false };
  writeFileSync(join(output, "receipt.json"), JSON.stringify(receipt, null, 2) + "\n", { mode: 0o600 });
  process.stdout.write(JSON.stringify(receipt, null, 2) + "\n");
  process.exitCode = status === "PASS_LOCAL_EXECUTED_GATES" ? 0 : 1;
}
