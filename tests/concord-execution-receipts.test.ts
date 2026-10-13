import { afterEach, describe, expect, it } from "vitest";
import { generateKeyPairSync, randomUUID, createHash, sign } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runReceiptProcess } from "../src/server/concord/receipt-process";
import { captureTreeManifest } from "../src/server/concord/tree-manifest";
import { collectLocalCheck, executionReceiptMetadata, localCheckCommand, signExecutionReceipt, verifyExecutionReceipt, type ExecutionReceiptPayload } from "../src/server/concord/execution-receipts";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const cwd = "/home/nur/Projects/archeagent-final-staging";
function node(script: string, timeoutMs = 2000, outputBytes = 1024) { return { executable: process.execPath, args: ["-e", script], cwd, timeoutMs, outputBytes }; }

describe("real bounded execution capture, not caller-reported results", () => {
  it("captures a real zero exit and independently known byte digest", async () => {
    // Replacing process capture with a claimed success/default result would lose these OS outputs.
    const result = await runReceiptProcess(node("process.stdout.write('hello'); process.stderr.write('note')"));
    expect(result.outcome).toBe("succeeded"); expect(result.exitCode).toBe(0); expect(result.signal).toBeNull();
    expect(result.stdout.retained.toString()).toBe("hello"); expect(result.stdout.bytes).toBe(5);
    expect(result.stdout.sha256).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
    expect(result.stderr.retained.toString()).toBe("note"); expect(Date.parse(result.finishedAt)).toBeGreaterThanOrEqual(Date.parse(result.startedAt));
  });
  it("does not turn a real nonzero exit into successful evidence", async () => {
    const result = await runReceiptProcess(node("process.stdout.write('failed'); process.exitCode = 7"));
    expect(result.exitCode).toBe(7); expect(result.outcome).toBe("failed");
  });
  it("kills a never-ending process at its deadline", async () => {
    const result = await runReceiptProcess(node("setInterval(() => {}, 1000)", 100));
    expect(result.timedOut).toBe(true); expect(result.outcome).toBe("timed_out"); expect(result.exitCode).toBeNull();
  });
  it("caps retained output and rejects a truncated execution even if it tries to exit zero", async () => {
    const result = await runReceiptProcess(node("process.stdout.write('X'.repeat(100000))", 2000, 64));
    expect(result.stdout.retained.length).toBe(64); expect(result.stdout.bytes).toBeGreaterThan(64);
    expect(result.stdout.truncated).toBe(true); expect(result.outcome).toBe("truncated");
  });
  it("snapshots budgets before launch instead of accepting caller mutation while output arrives", async () => {
    const command = node("setTimeout(() => process.stdout.write('X'.repeat(100000)), 50)", 2000, 64);
    const pending = runReceiptProcess(command); command.outputBytes = 100000;
    const result = await pending;
    expect(result.stdout.retained.length).toBe(64); expect(result.outcome).toBe("truncated");
  });
  it("records a signal and cannot interpret it as a successful exit", async () => {
    const result = await runReceiptProcess(node("process.kill(process.pid, 'SIGTERM')"));
    expect(result.exitCode).toBeNull(); expect(result.signal).toBe("SIGTERM"); expect(result.outcome).toBe("failed");
  });
  it("returns generic spawn failure without exposing private OS errors", async () => {
    const result = await runReceiptProcess({ ...node(""), executable: "/nonexistent/PRIVATE_EXECUTABLE_SENTINEL" });
    expect(result.outcome).toBe("spawn_failed"); expect(JSON.stringify(result)).not.toContain("PRIVATE_EXECUTABLE_SENTINEL");
  });
  it.each([{ timeoutMs: 0 }, { timeoutMs: Infinity }, { outputBytes: 0 }, { outputBytes: 2 ** 30 }])("rejects invalid execution budgets before launch: %o", async override => {
    await expect(runReceiptProcess({ ...node("process.exit(0)"), ...override })).rejects.toThrow("Receipt check unavailable");
  });
});

// These are signed protocol fixtures for adversarial verifier tests, not model
// activity or actual successful unit-check receipts. Only the process tests above
// execute commands. The production CLI collector is held and executes nothing.
function receiptFixture() {
  const parent = join(cwd, ".local-audit"); mkdirSync(parent, { recursive: true, mode: 0o700 });
  const root = mkdtempSync(join(parent, "signed-fixture-")); roots.push(root);
  writeFileSync(join(root, "package.json"), "{}"); writeFileSync(join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'");
  const manifest = captureTreeManifest(root);
  const key = generateKeyPairSync("ed25519", { privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
  const identity = { version: "archeagent.local-source.v1" as const, sourceInstanceId: randomUUID(), captureRunId: randomUUID(), createdAt: "2026-10-13T00:00:00.000Z", provenance: "scripted_protocol_test" as const };
  const revision = { eventId: 2, ownershipEventId: 1, updateId: 0, handoffId: 0, reviewId: 0, messageEventId: 0, taskCount: 1, taskVersionSum: 1 };
  const output = (kind: string) => ({ sha256: createHash("sha256").update("").digest("hex"), bytes: 0, retainedBytes: 0, truncated: false, privateFile: `receipt-${receiptId}-${kind}.log` });
  const receiptId = randomUUID();
  const payload: ExecutionReceiptPayload = {
    version: "archeagent.execution-receipt.v1", receiptId, sourceInstanceId: identity.sourceInstanceId, captureRunId: identity.captureRunId, provenance: identity.provenance,
    task: { taskId: "approved-task", actorId: "builder", versionBefore: 1, versionAfter: 1, ownershipEventId: 1, taskEventId: 2, ownershipUnchanged: true }, actorLink: "operator_assigned_unobserved",
    sourceRevision: { before: revision, after: { ...revision }, unchanged: true }, testedHead: "a".repeat(40), headAfter: "a".repeat(40), tree: { before: manifest, after: manifest, unchanged: true },
    check: { id: "unit-authority", executable: process.execPath, args: ["node_modules/vitest/vitest.mjs", "run", "tests/evaluator.test.ts", "tests/release/release-lease.test.ts"], kind: "verification", toolVersion: process.version },
    execution: { startedAt: "2026-10-13T00:00:01.000Z", finishedAt: "2026-10-13T00:00:02.000Z", exitCode: 0, signal: null, outcome: "succeeded", timedOut: false, stdout: output("stdout"), stderr: output("stderr") },
  };
  const context = { trustedPublicKey: key.publicKey, identity, taskId: "approved-task", actorId: "builder", treeDigest: manifest.digest };
  return { payload, key, context };
}
function independentCanonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(independentCanonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${independentCanonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function independentlySigned(payload: unknown, privateKey: string) { return { algorithm: "Ed25519", payload, signature: sign(null, Buffer.from(independentCanonical(payload)), privateKey).toString("base64url") }; }

describe("local collector signatures and exact receipt bindings", () => {
  it("verifies an independently signed strict receipt only using the configured key", () => {
    const { payload, key, context } = receiptFixture();
    const result = verifyExecutionReceipt(independentlySigned(payload, key.privateKey), context);
    expect(result.valid).toBe(true); expect(result.successful).toBe(true);
    expect(signExecutionReceipt(payload, key.privateKey)).toEqual(independentlySigned(payload, key.privateKey));
  });
  it("rejects a caller-owned key even when the payload says sourceAuthenticated", () => {
    const { payload, context } = receiptFixture(); const other = generateKeyPairSync("ed25519");
    const input = { algorithm: "Ed25519", payload, signature: sign(null, Buffer.from(independentCanonical(payload)), other.privateKey).toString("base64url"), sourceAuthenticated: true, trustedPublicKey: other.publicKey.export({ type: "spki", format: "pem" }) };
    expect(verifyExecutionReceipt(input, context).valid).toBe(false);
    delete (input as Partial<typeof input>).sourceAuthenticated; delete (input as Partial<typeof input>).trustedPublicKey;
    expect(verifyExecutionReceipt(input, context).valid).toBe(false);
  });
  it("rejects a same-length digest-only signature and payload tampering", () => {
    const { payload, key, context } = receiptFixture(); const input = independentlySigned(payload, key.privateKey);
    expect(verifyExecutionReceipt({ ...input, signature: createHash("sha256").update(independentCanonical(payload)).digest("hex") }, context).valid).toBe(false);
    expect(verifyExecutionReceipt({ ...input, payload: { ...payload, task: { ...payload.task, actorId: "reviewer" } } }, context).valid).toBe(false);
  });
  it.each(["source", "run", "task", "actor", "tree", "provenance"])("rejects a cryptographically valid %s mismatch", field => {
    const { payload, key, context } = receiptFixture(); const changed = structuredClone(payload);
    if (field === "source") changed.sourceInstanceId = randomUUID();
    if (field === "run") changed.captureRunId = randomUUID();
    if (field === "task") changed.task.taskId = "foreign-task";
    if (field === "actor") changed.task.actorId = "reviewer";
    if (field === "tree") context.treeDigest = "0".repeat(64);
    if (field === "provenance") changed.provenance = "current_capture";
    expect(verifyExecutionReceipt(independentlySigned(changed, key.privateKey), context).valid).toBe(false);
  });
  it.each(["failed", "timed_out", "truncated"] as const)("keeps a valid %s receipt authentic but ineligible for success", outcome => {
    const { payload, key, context } = receiptFixture(); const changed = structuredClone(payload);
    changed.execution.outcome = outcome;
    if (outcome === "failed") changed.execution.exitCode = 3;
    if (outcome === "timed_out") { changed.execution.exitCode = null; changed.execution.signal = "SIGKILL"; changed.execution.timedOut = true; }
    if (outcome === "truncated") { changed.execution.stdout.bytes = 2; changed.execution.stdout.retainedBytes = 1; changed.execution.stdout.truncated = true; }
    const result = verifyExecutionReceipt(independentlySigned(changed, key.privateKey), context);
    expect(result.valid).toBe(true); expect(result.successful).toBe(false);
  });
  it("cannot promote a diagnostic node-version receipt into completed product checks", () => {
    const { payload, key, context } = receiptFixture(); payload.check = { id: "runtime-node", executable: process.execPath, args: ["--version"], kind: "diagnostic", toolVersion: process.version };
    const result = verifyExecutionReceipt(independentlySigned(payload, key.privateKey), context);
    expect(result.valid).toBe(true); expect(result.successful).toBe(false);
  });
  it.each(["result", "counts", "time", "version", "algorithm", "command", "private-path", "claimed-model", "tree-contradiction", "revision-contradiction"])("rejects correctly signed contradictory or unsupported %s fields", field => {
    const { payload, key, context } = receiptFixture(); const changed = structuredClone(payload);
    let input: unknown;
    if (field === "result") changed.execution.exitCode = 9;
    if (field === "counts") changed.execution.stdout.retainedBytes = 2;
    if (field === "time") changed.execution.finishedAt = "2026-10-12T00:00:00.000Z";
    if (field === "version") Object.assign(changed, { version: "caller.execution.v2" });
    if (field === "command") changed.check.args = ["-e", "process.exit(0)"];
    if (field === "private-path") changed.execution.stdout.privateFile = "/home/nur/private-transcript";
    if (field === "claimed-model") Object.assign(changed, { modelSessionAuthenticated: true });
    if (field === "tree-contradiction") changed.tree.after.digest = "0".repeat(64);
    if (field === "revision-contradiction") changed.sourceRevision.after.eventId++;
    input = independentlySigned(changed, key.privateKey);
    if (field === "algorithm") input = { ...(input as object), algorithm: "SHA256" };
    expect(verifyExecutionReceipt(input, context).valid).toBe(false);
  });
  it("marks a changed relevant tree or source revision ineligible without inventing a clean result", () => {
    const { payload, key, context } = receiptFixture(); payload.sourceRevision.after.eventId++; payload.sourceRevision.unchanged = false;
    const result = verifyExecutionReceipt(independentlySigned(payload, key.privateKey), context);
    expect(result.valid).toBe(true); expect(result.successful).toBe(false);
  });
  it("keeps a real changed after-manifest signed but ineligible for success", () => {
    const { payload, key, context } = receiptFixture();
    const root = roots[roots.length - 1]; writeFileSync(join(root, "package.json"), '{"changed":true}');
    payload.tree.after = captureTreeManifest(root); payload.tree.unchanged = false;
    const result = verifyExecutionReceipt(independentlySigned(payload, key.privateKey), context);
    expect(result.valid).toBe(true); expect(result.successful).toBe(false);
  });
  it("rejects a backwards source revision even when unchanged is correctly false", () => {
    const { payload, key, context } = receiptFixture(); payload.sourceRevision.after.eventId = 1; payload.sourceRevision.unchanged = false;
    expect(verifyExecutionReceipt(independentlySigned(payload, key.privateKey), context).valid).toBe(false);
  });
  it("redacts command arguments/output/private references from projection metadata and denies release", () => {
    const { payload, key, context } = receiptFixture(); const input = independentlySigned(payload, key.privateKey);
    const result = executionReceiptMetadata(input, context); const text = JSON.stringify(result);
    expect(result.signatureVerified).toBe(true); expect(result.releaseAuthorized).toBe(false); expect(result.modelSessionAuthenticated).toBe(false);
    expect(text).not.toContain("privateFile"); expect(text).not.toContain("node_modules"); expect(text).not.toContain("stdout");
    expect(result.trustBoundary).toBe("local_host_same_uid");
  });
});

describe("production collector remains closed at the failed SQLite isolation gate", () => {
  it("rejects collection before source/key/storage acquisition or actual check execution", async () => {
    const state = join(cwd, ".concord");
    const before = ["source.json", "concord.sqlite", "recorder.sqlite", "receipt-key.json"].map(name => existsSync(join(state, name)));
    await expect(collectLocalCheck({ actorId: "builder", taskId: "approved-task", checkId: "runtime-node" })).rejects.toThrow("SQLite isolation gate is held");
    expect(["source.json", "concord.sqlite", "recorder.sqlite", "receipt-key.json"].map(name => existsSync(join(state, name)))).toEqual(before);
  });
  it("exposes only fixed checks and cannot map arbitrary caller commands or full production-service tests", () => {
    expect(localCheckCommand("unit-authority").args).toEqual(["node_modules/vitest/vitest.mjs", "run", "tests/evaluator.test.ts", "tests/release/release-lease.test.ts"]);
    expect(() => localCheckCommand("test-all" as "runtime-node")).toThrow("Receipt check unavailable");
    expect(() => localCheckCommand("-e process.exit(0)" as "runtime-node")).toThrow("Receipt check unavailable");
  });
  it("offers executable help but returns the held gate rather than creating scripted receipts", () => {
    const command = ["--import", "tsx", "scripts/concord-local-check.ts"];
    const help = execFileSync(process.execPath, [...command, "--help"], { cwd, encoding: "utf8", timeout: 5000 });
    expect(help).toContain("SQLite isolation gate is held"); expect(help).toContain("unit-authority");
    try {
      execFileSync(process.execPath, [...command, "--actor", "builder", "--task", "approved-task", "--check", "runtime-node"], { cwd, encoding: "utf8", timeout: 5000, stdio: "pipe" });
      throw new Error("Unexpected collector success");
    } catch (error) {
      const output = error as { status?: number; stderr?: string };
      expect(output.status).toBe(2); expect(output.stderr).toContain("SQLite isolation gate is held");
    }
  });
});
