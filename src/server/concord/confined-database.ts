import Database from "better-sqlite3";
import { createRepositories } from "@concord-ai/concord-mcp/dist/db/index.js";
import { migrations } from "@concord-ai/concord-mcp/dist/db/schema.js";
import { assertLocalAcquisitionGate, validateLocalPaths, type LocalPaths } from "./local-paths";

/** Only a kernel-confined worker can acquire a disk-backed SQLite connection. */
export function openConfinedDatabase(paths: LocalPaths, kind: "concord" | "recorder", options: { readonly?: boolean; fileMustExist?: boolean } = {}): Database.Database {
  assertLocalAcquisitionGate(paths);
  validateLocalPaths(paths);
  if (kind !== "concord" && kind !== "recorder") throw new Error("Confined database unavailable");
  const filename = kind === "concord" ? paths.concordDb : paths.recorderDb;
  const db = new Database(filename, { readonly: options.readonly === true, fileMustExist: options.fileMustExist === true });
  try {
    db.pragma("busy_timeout = 5000");
    db.pragma("foreign_keys = ON");
    if (options.readonly) db.pragma("query_only = ON");
    else db.pragma("journal_mode = WAL");
    validateLocalPaths(paths);
    return db;
  } catch {
    db.close();
    throw new Error("Confined database unavailable");
  }
}

/** Reuse Concord's unchanged migrations and repository implementation. */
export function openConfinedConcordRepositories(paths: LocalPaths) {
  const db = openConfinedDatabase(paths, "concord");
  try {
    const applied = db.pragma("user_version", { simple: true });
    if (!Number.isSafeInteger(applied) || Number(applied) < 0 || Number(applied) > migrations.length) throw new Error();
    for (let index = Number(applied); index < migrations.length; index++) {
      // Migration SQL and version advancement commit together; no schema fork.
      db.transaction(() => { db.exec(migrations[index]); db.pragma(`user_version = ${index + 1}`); })();
    }
    return createRepositories(db);
  } catch { db.close(); throw new Error("Confined Concord database unavailable"); }
}
