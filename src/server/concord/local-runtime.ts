import { randomUUID } from "node:crypto";
import { constants, closeSync, fstatSync, openSync, readFileSync } from "node:fs";
import { z } from "zod";
import { openConfinedDatabase, openConfinedConcordRepositories } from "./confined-database";
import { assertLocalAcquisitionGate, assertSafeFile, ensureLocalStateDirectory, LocalStateError, resolveLocalPaths, validateLocalPaths, writePrivateFile, type LocalPaths } from "./local-paths";
import { ensurePrivateStoreSchema, openPrivateStore } from "./private-store";
import { createBoundAdapter } from "./adapter";

export const localIdentitySchema = z.object({ version: z.literal("archeagent.local-source.v1"), sourceInstanceId: z.uuid(), captureRunId: z.uuid(), createdAt: z.iso.datetime(), provenance: z.enum(["current_capture", "scripted_protocol_test"]) }).strict();
export type LocalIdentity = z.infer<typeof localIdentitySchema>;
export function readLocalIdentity(paths: LocalPaths = resolveLocalPaths()): LocalIdentity {
  validateLocalPaths(paths);
  assertSafeFile(paths.sourceFile, false); assertSafeFile(paths.concordDb, false); assertSafeFile(paths.recorderDb, false);
  const fd = openSync(paths.sourceFile, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > 4096) throw new LocalStateError();
    const identity = localIdentitySchema.parse(JSON.parse(readFileSync(fd, "utf8")));
    if ((paths.stateDir.endsWith("/.concord") ? "current_capture" : "scripted_protocol_test") !== identity.provenance) throw new LocalStateError();
    return identity;
  } catch { throw new LocalStateError(); } finally { closeSync(fd); }
}
export const getLocalIdentity = readLocalIdentity;

/** Explicit initialization creates schema and identity, never synthetic agents/tasks. */
export function initializeLocalState(paths: LocalPaths = resolveLocalPaths()): LocalIdentity {
  assertLocalAcquisitionGate(paths);
  validateLocalPaths(paths);
  try { assertSafeFile(paths.sourceFile, false); return readLocalIdentity(paths); } catch (error) {
    // Only absence permits initialization. An invalid initialized source fails closed.
    if (!(error instanceof LocalStateError)) throw error;
    try { const fd = openSync(paths.sourceFile, constants.O_RDONLY | constants.O_NOFOLLOW); closeSync(fd); throw new LocalStateError(); } catch (missing) { if ((missing as NodeJS.ErrnoException).code !== "ENOENT") throw new LocalStateError(); }
  }
  ensureLocalStateDirectory(paths);
  const identity = localIdentitySchema.parse({ version: "archeagent.local-source.v1", sourceInstanceId: randomUUID(), captureRunId: randomUUID(), createdAt: new Date().toISOString(), provenance: paths.stateDir.endsWith("/.concord") ? "current_capture" : "scripted_protocol_test" });
  validateLocalPaths(paths);
  const repos = openConfinedConcordRepositories(paths);
  try {
    // Refuse adopting an existing populated database without its original identity.
    if (repos.tasks.list().length || repos.agents.list().length || repos.events.list().length) throw new LocalStateError();
  } finally { repos.db.close(); }
  validateLocalPaths(paths);
  const companion = openConfinedDatabase(paths, "recorder");
  try { companion.pragma("journal_mode = WAL"); companion.pragma("busy_timeout = 5000"); ensurePrivateStoreSchema(companion, identity); } finally { companion.close(); }
  writePrivateFile(paths, paths.sourceFile, JSON.stringify(identity), true);
  return readLocalIdentity(paths);
}

/** The actor is operator-assigned; this function makes no model/session claim. */
export function openLocalRuntime(actorId: string, captureRunId: string, paths: LocalPaths = resolveLocalPaths()) {
  assertLocalAcquisitionGate(paths);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,127}$/.test(actorId)) throw new LocalStateError();
  const identity = readLocalIdentity(paths);
  if (identity.captureRunId !== captureRunId) throw new LocalStateError();
  validateLocalPaths(paths);
  const repos = openConfinedConcordRepositories(paths);
  try {
    // Pull-only is a store invariant, not merely a dispatcher preference.
    if (repos.agentEndpoints.list().some(endpoint => endpoint.transport !== "pull" || endpoint.capabilities.some(capability => capability === "local-ipc" || capability === "app-server" || capability === "inject" || capability === "steer"))) throw new LocalStateError();
    const store = openPrivateStore(paths);
    const adapter = createBoundAdapter({ repos, store, paths, identity, actorId });
    let closed = false;
    return { ...adapter, repos, identity, paths, async close() {
      if (closed) return; closed = true;
      // A failed transport shutdown or newly unsafe state must not strand
      // either already-acquired database descriptor.
      try { await adapter.server.close(); }
      finally { try { store.close(); } finally { repos.db.close(); } }
    } };
  } catch (error) { repos.db.close(); throw error; }
}
