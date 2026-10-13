import { z } from "zod";
import { createHash } from "node:crypto";
import { localIdentitySchema } from "./local-runtime";
import { sourceRevisionSchema } from "./private-store";
export const MAX_SNAPSHOT = 24 * 1024 * 1024;
export const MAX_REQUEST = 65536;
export const actorSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,127}$/);
export const toolSchema = z.enum(["start_work", "inspect_work", "update_work", "transfer_work", "finish_work", "register_pull_endpoint", "drain_own_inbox"]);
const databaseSchema = z.string().max(12 * 1024 * 1024).regex(/^[A-Za-z0-9+/]+={0,2}$/);
export const bundleSchema = z.object({ version: z.literal("archeagent.durable-state.v1"), identity: localIdentitySchema, concord: databaseSchema, recorder: databaseSchema }).strict();
export type SnapshotBundle = z.infer<typeof bundleSchema>;
export const operationSchema = z.object({ op: z.literal("call"), actor: actorSchema, id: z.uuid(), tool: toolSchema, args: z.record(z.string(), z.unknown()) }).strict();
export type DurableOperation = z.infer<typeof operationSchema>;
export const auditMetadataSchema = z.object({ sourceInstanceId: z.uuid(), captureRunId: z.uuid(), sourceRevision: sourceRevisionSchema, invocationCount: z.number().int().nonnegative(), retryCount: z.number().int().nonnegative(), walActive: z.literal(true), provenance: z.literal("scripted_protocol_test") }).strict();
export function requestDigest(request: DurableOperation): string {
  // Exact transport bytes are the retry contract; reordered JSON is not silently equivalent.
  return createHash("sha256").update(JSON.stringify({ actor: request.actor, tool: request.tool, args: request.args })).digest("hex");
}
export function parseBundle(bytes: Buffer): SnapshotBundle {
  if (!bytes.length || bytes.length > MAX_SNAPSHOT) throw new Error("Snapshot bound exceeded");
  const bundle = bundleSchema.parse(JSON.parse(bytes.toString("utf8")));
  if (bundle.identity.provenance !== "scripted_protocol_test") throw new Error("Real source remains held");
  for (const field of [bundle.concord, bundle.recorder]) {
    const data = Buffer.from(field, "base64");
    if (data.length > 8 * 1024 * 1024 || data.length < 100 || data.toString("base64") !== field || data.subarray(0, 16).toString() !== "SQLite format 3\u0000") throw new Error("Invalid SQLite snapshot");
  }
  return bundle;
}
