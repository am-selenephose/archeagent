import { constants, closeSync, fstatSync, ftruncateSync, lstatSync, mkdirSync, openSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { assertSqliteProcessBoundary } from "./sqlite-confinement";

export const LOCAL_ROOT = "/home/nur/Projects/archeagent-final-staging";
export interface LocalPaths { rootDir: string; stateDir: string; concordDb: string; recorderDb: string; sourceFile: string }

export class LocalStateError extends Error {
  constructor() { super("Local Concord state is unavailable or unsafe."); this.name = "LocalStateError"; }
}
/** Independent alias-acquisition reproduction failed: no production escape hatch. */
export function assertLocalAcquisitionGate(paths: LocalPaths): void {
  if (paths.stateDir === `${LOCAL_ROOT}/.concord`) throw new Error("Local SQLite isolation gate is held");
  assertSqliteProcessBoundary(paths);
  validateLocalPaths(paths);
}
function statIfPresent(filename: string) {
  try { return lstatSync(filename); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw new LocalStateError(); }
}
function directory(filename: string, missing = false) {
  const stat = statIfPresent(filename);
  if (!stat && missing) return;
  if (!stat || stat.isSymbolicLink() || !stat.isDirectory() || realpathSync(filename) !== filename) throw new LocalStateError();
  if (filename !== LOCAL_ROOT && (stat.uid !== process.getuid?.() || (stat.mode & 0o777) !== 0o700)) throw new LocalStateError();
}
export function assertSafeFile(filename: string, missing = true): void {
  const stat = statIfPresent(filename);
  if (!stat && missing) return;
  if (!stat || !stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.uid !== process.getuid?.()) throw new LocalStateError();
}
function scanState(dir: string, budget: { remaining: number }, depth = 0): void {
  directory(dir);
  if (depth > 8) throw new LocalStateError();
  for (const name of readdirSync(dir)) {
    if (--budget.remaining < 0) throw new LocalStateError();
    const filename = join(dir, name);
    const stat = lstatSync(filename);
    if (stat.isSymbolicLink()) throw new LocalStateError();
    if (stat.isDirectory()) scanState(filename, budget, depth + 1);
    else assertSafeFile(filename, false);
  }
}

/** No cwd, environment, git-common-dir, or caller root is consulted. */
export function resolveLocalPaths(): LocalPaths {
  const stateDir = join(LOCAL_ROOT, ".concord");
  const paths = { rootDir: LOCAL_ROOT, stateDir, concordDb: join(stateDir, "concord.sqlite"), recorderDb: join(stateDir, "recorder.sqlite"), sourceFile: join(stateDir, "source.json") };
  validateLocalPaths(paths);
  return paths;
}

/** The only alternative scope is an explicitly labeled scripted-test directory. */
export function validateLocalPaths(paths: LocalPaths): void {
  if (paths.rootDir !== LOCAL_ROOT) throw new LocalStateError();
  directory(LOCAL_ROOT);
  const stateRoot = join(LOCAL_ROOT, ".concord");
  const testRelative = relative(join(stateRoot, "test-harness"), paths.stateDir);
  if (paths.stateDir !== stateRoot && !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/.test(testRelative)) throw new LocalStateError();
  if (paths.concordDb !== join(paths.stateDir, "concord.sqlite") || paths.recorderDb !== join(paths.stateDir, "recorder.sqlite") || paths.sourceFile !== join(paths.stateDir, "source.json")) throw new LocalStateError();
  directory(stateRoot, true);
  if (paths.stateDir !== stateRoot) directory(join(stateRoot, "test-harness"), true);
  directory(paths.stateDir, true);
  // Validate all private descendants, including unknown secret/output sidecars.
  // The test-harness tree is separate so a deliberately unsafe fixture cannot
  // block another owned fixture's independent acquisition.
  if (statIfPresent(paths.stateDir)) {
    if (paths.stateDir === stateRoot) {
      const budget = { remaining: 4096 };
      for (const name of readdirSync(stateRoot)) {
        if (name === "test-harness") { directory(join(stateRoot, name)); continue; }
        const filename = join(stateRoot, name); const stat = lstatSync(filename);
        if (stat.isDirectory() && !stat.isSymbolicLink()) scanState(filename, budget);
        else assertSafeFile(filename, false);
      }
    } else scanState(paths.stateDir, { remaining: 4096 });
  }
  for (const filename of [paths.concordDb, paths.recorderDb, paths.sourceFile, `${paths.concordDb}-wal`, `${paths.concordDb}-shm`, `${paths.concordDb}-journal`, `${paths.recorderDb}-wal`, `${paths.recorderDb}-shm`, `${paths.recorderDb}-journal`, ...["WORK_STATE.json", "events.jsonl", "HANDOFF.md", "REVIEW_PACKET.md"].map(name => join(paths.stateDir, name))]) assertSafeFile(filename);
}

export function ensureLocalStateDirectory(paths: LocalPaths): void {
  validateLocalPaths(paths);
  const ancestors = [join(LOCAL_ROOT, ".concord")];
  if (paths.stateDir !== ancestors[0]) ancestors.push(join(ancestors[0], "test-harness"), paths.stateDir);
  for (const ancestor of ancestors) {
    directory(ancestor, true);
    if (!statIfPresent(ancestor)) mkdirSync(ancestor, { mode: 0o700 });
    directory(ancestor);
  }
  validateLocalPaths(paths);
}

/** Validated non-following create/update for adapter-owned private sidecars. */
export function writePrivateFile(paths: LocalPaths, filename: string, data: string | Buffer, exclusive = false): void {
  validateLocalPaths(paths);
  const rel = relative(paths.stateDir, filename);
  if (!rel || rel.startsWith("..") || rel.includes("/") || dirname(filename) !== paths.stateDir) throw new LocalStateError();
  assertSafeFile(filename);
  const expected = statIfPresent(filename);
  const fd = openSync(filename, constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW | (exclusive ? constants.O_EXCL : 0), 0o600);
  try {
    const stat = fstatSync(fd); const leaf = lstatSync(filename);
    if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid?.() || stat.dev !== leaf.dev || stat.ino !== leaf.ino || (expected && (expected.dev !== stat.dev || expected.ino !== stat.ino))) throw new LocalStateError();
    // Destructive truncation happens only after descriptor/alias validation.
    ftruncateSync(fd, 0);
    writeFileSync(fd, data);
  } finally { closeSync(fd); }
  validateLocalPaths(paths);
}
