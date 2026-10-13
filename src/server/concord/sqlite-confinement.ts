import { readFileSync, realpathSync, statfsSync, lstatSync } from "node:fs";
import type { LocalPaths } from "./local-paths";

const ROOT = "/home/nur/Projects/archeagent-final-staging";
const STATE = `${ROOT}/.concord`;
const TMPFS_MAGIC = 0x01021994;
export class SqliteConfinementError extends Error {
  constructor() { super("SQLite process confinement unavailable"); this.name = "SqliteConfinementError"; }
}

/** Inspect kernel state, never a caller/environment assertion of sandboxing. */
export function assertSqliteProcessBoundary(paths: Pick<LocalPaths, "rootDir" | "stateDir">): void {
  try {
    if (process.platform !== "linux" || paths.rootDir !== ROOT || (paths.stateDir !== STATE && (!paths.stateDir.startsWith(`${STATE}/`) || !/^test-harness\/[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/.test(paths.stateDir.slice(STATE.length + 1))))) throw new Error();
    if (realpathSync(STATE) !== STATE || lstatSync(STATE).isSymbolicLink() || statfsSync(STATE).type !== TMPFS_MAGIC) throw new Error();
    const status = readFileSync("/proc/self/status", "utf8");
    if (!/^NoNewPrivs:\s+1$/m.test(status) || !/^CapEff:\s+0+$/m.test(status)) throw new Error();
    const mounts = readFileSync("/proc/self/mountinfo", "utf8").trim().split("\n").map(line => {
      const [before, after] = line.split(" - ");
      const fields = before.split(" ");
      if (!after || fields.length < 6) throw new Error();
      return { path: fields[4], flags: fields[5].split(","), fs: after.split(" ")[0] };
    });
    const state = mounts.filter(mount => mount.path === STATE);
    if (state.length !== 1 || state[0].fs !== "tmpfs" || !state[0].flags.includes("rw") || !state[0].flags.includes("nodev") || !state[0].flags.includes("nosuid")) throw new Error();
    // No writable host mounts, alternate scratch directories or hidden submounts.
    if (mounts.some(mount => mount.path !== STATE && !mount.flags.includes("ro"))) throw new Error();
    if (mounts.some(mount => mount.path.startsWith(`${STATE}/`))) throw new Error();
    for (const path of ["/", ROOT, "/proc"]) if (!mounts.some(mount => mount.path === path && mount.flags.includes("ro"))) throw new Error();
  } catch { throw new SqliteConfinementError(); }
}

export function isSqliteProcessConfined(): boolean {
  try { assertSqliteProcessBoundary({ rootDir: ROOT, stateDir: STATE }); return true; }
  catch { return false; }
}
