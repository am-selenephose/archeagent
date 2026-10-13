import type { LocalIdentity } from "./local-runtime";
import { treeManifestSchema, validTreeManifest, type TreeManifest } from "./tree-manifest";
import { sourceRevisionSchema, type SourceRevision } from "./private-store";
import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { z } from "zod";
import { canonicalReceiptJson } from "./receipt-canonical";
import { LOCAL_ROOT } from "./local-paths";
import type { ReceiptCommand } from "./receipt-process";

export const LOCAL_CHECK_IDS = ["runtime-node", "unit-authority", "typecheck", "lint"] as const;
export type LocalCheckId = typeof LOCAL_CHECK_IDS[number];
/** Deliberately excludes full integration tests unless independently owned services are supplied. */
export function localCheckCommand(id: LocalCheckId): ReceiptCommand & { kind: "diagnostic" | "verification" } {
  const commands = {
    "runtime-node": { args: ["--version"], kind: "diagnostic" as const, timeoutMs: 5000 },
    "unit-authority": { args: ["node_modules/vitest/vitest.mjs", "run", "tests/evaluator.test.ts", "tests/release/release-lease.test.ts"], kind: "verification" as const, timeoutMs: 120_000 },
    typecheck: { args: ["node_modules/typescript/bin/tsc", "--noEmit", "--incremental", "false"], kind: "verification" as const, timeoutMs: 120_000 },
    lint: { args: ["node_modules/eslint/bin/eslint.js"], kind: "verification" as const, timeoutMs: 120_000 },
  };
  if (!Object.hasOwn(commands, id)) throw new Error("Receipt check unavailable");
  return { executable: process.execPath, cwd: LOCAL_ROOT, outputBytes: 131_072, ...commands[id], args: [...commands[id].args] };
}
export interface ExecutionReceiptPayload {
  version: "archeagent.execution-receipt.v1"; receiptId: string; sourceInstanceId: string; captureRunId: string; provenance: "current_capture" | "scripted_protocol_test";
  task: { taskId: string; actorId: string; versionBefore: number; versionAfter: number; ownershipEventId: number; taskEventId: number; ownershipUnchanged: boolean };
  actorLink: "operator_assigned_unobserved";
  sourceRevision: { before: SourceRevision; after: SourceRevision; unchanged: boolean };
  testedHead: string; headAfter: string; tree: { before: TreeManifest; after: TreeManifest; unchanged: boolean };
  check: { id: string; executable: string; args: string[]; kind: "diagnostic" | "verification"; toolVersion: string };
  execution: { startedAt: string; finishedAt: string; exitCode: number | null; signal: string | null; outcome: "succeeded" | "failed" | "timed_out" | "truncated" | "spawn_failed"; timedOut: boolean; stdout: ReceiptOutput; stderr: ReceiptOutput };
}
export interface ReceiptOutput { sha256: string; bytes: number; retainedBytes: number; truncated: boolean; privateFile: string }
export interface ExecutionReceiptEnvelope { algorithm: "Ed25519"; payload: ExecutionReceiptPayload; signature: string }
export interface ReceiptVerificationContext { trustedPublicKey: string; identity: LocalIdentity; taskId: string; actorId: string; treeDigest: string }
/** Storage/collector integration is deliberately disabled at the failed isolation gate. */
export async function collectLocalCheck(input: { actorId: string; taskId: string; checkId: LocalCheckId }): Promise<ExecutionReceiptEnvelope> {
  void input;
  throw new Error("Local SQLite isolation gate is held");
}
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const opaqueId = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,127}$/);
const outputSchema = z.object({ sha256: digest, bytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), retainedBytes: z.number().int().nonnegative().max(131_072), truncated: z.boolean(), privateFile: z.string().max(128) }).strict().refine(value => value.retainedBytes <= value.bytes && value.truncated === (value.retainedBytes < value.bytes) && (value.bytes !== 0 || value.sha256 === "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"));
const executionSchema = z.object({ startedAt: z.iso.datetime(), finishedAt: z.iso.datetime(), exitCode: z.number().int().min(0).max(255).nullable(), signal: z.enum(["SIGABRT", "SIGALRM", "SIGBUS", "SIGFPE", "SIGHUP", "SIGILL", "SIGINT", "SIGKILL", "SIGPIPE", "SIGQUIT", "SIGSEGV", "SIGTERM", "SIGUSR1", "SIGUSR2", "SIGTRAP", "SIGXCPU", "SIGXFSZ"]).nullable(), outcome: z.enum(["succeeded", "failed", "timed_out", "truncated", "spawn_failed"]), timedOut: z.boolean(), stdout: outputSchema, stderr: outputSchema }).strict().refine(value => {
  const duration = Date.parse(value.finishedAt) - Date.parse(value.startedAt);
  if (duration < 0 || duration > 305_000 || (value.signal !== null && value.exitCode !== null)) return false;
  if (value.timedOut) return value.outcome === "timed_out";
  if (value.stdout.truncated || value.stderr.truncated) return value.outcome === "truncated";
  if (value.outcome === "spawn_failed") return value.exitCode === null && value.signal === null && value.stdout.bytes === 0 && value.stderr.bytes === 0;
  if (value.exitCode === 0 && value.signal === null) return value.outcome === "succeeded";
  return value.outcome === "failed" && (value.exitCode !== null || value.signal !== null);
});
export const executionReceiptPayloadSchema = z.object({
  version: z.literal("archeagent.execution-receipt.v1"), receiptId: z.uuid(), sourceInstanceId: z.uuid(), captureRunId: z.uuid(), provenance: z.enum(["current_capture", "scripted_protocol_test"]),
  task: z.object({ taskId: opaqueId, actorId: opaqueId, versionBefore: z.number().int().positive(), versionAfter: z.number().int().positive(), ownershipEventId: z.number().int().positive(), taskEventId: z.number().int().positive(), ownershipUnchanged: z.boolean() }).strict(),
  actorLink: z.literal("operator_assigned_unobserved"),
  sourceRevision: z.object({ before: sourceRevisionSchema, after: sourceRevisionSchema, unchanged: z.boolean() }).strict(),
  testedHead: z.string().regex(/^[a-f0-9]{40}$/), headAfter: z.string().regex(/^[a-f0-9]{40}$/), tree: z.object({ before: treeManifestSchema, after: treeManifestSchema, unchanged: z.boolean() }).strict(),
  check: z.object({ id: z.enum(LOCAL_CHECK_IDS), executable: z.string().max(2048), args: z.array(z.string().max(2048)).max(32), kind: z.enum(["diagnostic", "verification"]), toolVersion: z.string().regex(/^v\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/).max(128) }).strict(), execution: executionSchema,
}).strict().refine(value => {
  const check = localCheckCommand(value.check.id);
  return value.check.executable === check.executable && value.check.kind === check.kind && canonicalReceiptJson(value.check.args) === canonicalReceiptJson(check.args)
    && !!validTreeManifest(value.tree.before) && !!validTreeManifest(value.tree.after)
    && value.tree.unchanged === (value.tree.before.digest === value.tree.after.digest)
    && value.sourceRevision.unchanged === (canonicalReceiptJson(value.sourceRevision.before) === canonicalReceiptJson(value.sourceRevision.after))
    && Object.keys(value.sourceRevision.before).every(key => value.sourceRevision.after[key as keyof SourceRevision] >= value.sourceRevision.before[key as keyof SourceRevision])
    && (!value.task.ownershipUnchanged || value.task.versionBefore === value.task.versionAfter)
    && value.task.ownershipEventId <= value.sourceRevision.before.ownershipEventId && value.task.taskEventId <= value.sourceRevision.before.eventId
    && value.sourceRevision.before.taskCount >= 1 && value.sourceRevision.after.taskCount >= 1
    && value.execution.stdout.privateFile === `receipt-${value.receiptId}-stdout.log` && value.execution.stderr.privateFile === `receipt-${value.receiptId}-stderr.log`;
});
export const executionReceiptEnvelopeSchema = z.object({ algorithm: z.literal("Ed25519"), payload: executionReceiptPayloadSchema, signature: z.string().regex(/^[a-zA-Z0-9_-]{86}$/) }).strict();

export function signExecutionReceipt(input: ExecutionReceiptPayload, privateKey: string): ExecutionReceiptEnvelope {
  try {
    const payload = executionReceiptPayloadSchema.parse(input); const key = createPrivateKey(privateKey);
    if (key.asymmetricKeyType !== "ed25519") throw new Error();
    return { algorithm: "Ed25519", payload, signature: sign(null, Buffer.from(canonicalReceiptJson(payload)), key).toString("base64url") };
  } catch { throw new Error("Receipt unavailable"); }
}
export function verifyExecutionReceipt(input: unknown, context: ReceiptVerificationContext): { valid: boolean; successful: boolean; code: string; payload?: ExecutionReceiptPayload } {
  const invalid = (code: string) => ({ valid: false, successful: false, code });
  try {
    canonicalReceiptJson(input); // Bound before schema traversal; reject cyclic/non-JSON objects.
    const parsed = executionReceiptEnvelopeSchema.safeParse(input); if (!parsed.success) return invalid("malformed");
    const { payload, signature } = parsed.data; const key = createPublicKey(context.trustedPublicKey);
    if (key.asymmetricKeyType !== "ed25519") return invalid("signature");
    const bytes = Buffer.from(signature, "base64url");
    if (bytes.length !== 64 || bytes.toString("base64url") !== signature || !verify(null, Buffer.from(canonicalReceiptJson(payload)), key, bytes)) return invalid("signature");
    if (payload.sourceInstanceId !== context.identity.sourceInstanceId || payload.captureRunId !== context.identity.captureRunId || payload.provenance !== context.identity.provenance || payload.task.taskId !== context.taskId || payload.task.actorId !== context.actorId) return invalid("scope");
    if (payload.tree.before.digest !== context.treeDigest) return invalid("tree");
    const successful = payload.check.kind === "verification" && payload.execution.outcome === "succeeded" && payload.task.ownershipUnchanged && payload.sourceRevision.unchanged && payload.tree.unchanged && payload.testedHead === payload.headAfter;
    return { valid: true, successful, code: "verified", payload };
  } catch { return invalid("unavailable"); }
}
export function executionReceiptMetadata(input: unknown, context: ReceiptVerificationContext): Record<string, unknown> {
  const result = verifyExecutionReceipt(input, context);
  const common = { signatureVerified: result.valid, trustBoundary: "local_host_same_uid", sourceAuthentication: "local_collector_signature_only", modelSessionAuthenticated: false, releaseAuthorized: false, completionAuthorized: false };
  if (!result.valid || !result.payload) return { ...common, status: "unverified", reason: result.code };
  const value = result.payload;
  return { ...common, receiptId: value.receiptId, sourceInstanceId: value.sourceInstanceId, captureRunId: value.captureRunId, taskId: value.task.taskId, actorId: value.task.actorId, actorLink: value.actorLink, provenance: value.provenance, checkId: value.check.id, checkKind: value.check.kind, startedAt: value.execution.startedAt, finishedAt: value.execution.finishedAt, exitCode: value.execution.exitCode, signal: value.execution.signal, executionOutcome: value.execution.outcome, successful: result.successful, treeDigest: value.tree.before.digest, treeUnchanged: value.tree.unchanged, sourceUnchanged: value.sourceRevision.unchanged, ownershipUnchanged: value.task.ownershipUnchanged, status: result.successful ? "captured_success" : "captured_not_successful" };
}
