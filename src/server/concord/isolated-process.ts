import { spawn } from "node:child_process";
import { lstatSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { LOCAL_ROOT, validateLocalPaths, resolveLocalPaths } from "./local-paths";

export type IsolatedCheck = "adapter-tests" | "adversarial" | "durable-worker";
type CheckResult = { exitCode: number | null; stdout: string; stderr: string };
const MAX_OUTPUT = 2 * 1024 * 1024;

/** Fixed repository-owned policy. No caller mount, root, SQL or executable options. */
export function isolatedCheckArguments(check: IsolatedCheck, witness?: string): string[] {
  if (process.platform !== "linux" || !["adapter-tests", "adversarial", "durable-worker"].includes(check)) throw new Error("Isolated check unavailable");
  validateLocalPaths(resolveLocalPaths());
  const node = realpathSync(process.execPath);
  if (!lstatSync(node).isFile() || lstatSync(node).uid !== process.getuid?.()) throw new Error("Isolated check unavailable");
  if (check === "adversarial" && (!witness || !/^\.local-audit\/storage-witness-[a-zA-Z0-9]+$/.test(witness))) throw new Error("Isolated check unavailable");
  if (check !== "adversarial" && witness !== undefined) throw new Error("Isolated check unavailable");
  const args = ["--unshare-all", "--unshare-user", "--die-with-parent", "--new-session", "--disable-userns", "--cap-drop", "ALL", "--clearenv",
    "--setenv", "PATH", "/usr/bin:/bin", "--setenv", "NODE_ENV", "test", "--setenv", "NO_COLOR", "1", "--setenv", "TMPDIR", `${LOCAL_ROOT}/.concord/test-harness/compiler`, "--setenv", "TSX_DISABLE_CACHE", "1",
    "--ro-bind", "/usr", "/usr", "--ro-bind", "/lib", "/lib", "--ro-bind", "/lib64", "/lib64",
    "--ro-bind", "/etc/passwd", "/etc/passwd", "--setenv", "XDG_DATA_HOME", `${LOCAL_ROOT}/.concord/test-harness/compiler`,
    "--ro-bind", LOCAL_ROOT, LOCAL_ROOT, "--ro-bind", node, node,
    "--perms", "0700", "--size", "134217728", "--tmpfs", join(LOCAL_ROOT, ".concord"),
    "--perms", "0700", "--dir", `${LOCAL_ROOT}/.concord/test-harness`, "--perms", "0700", "--dir", `${LOCAL_ROOT}/.concord/test-harness/compiler`,
    "--proc", "/proc", "--remount-ro", "/proc", "--remount-ro", "/", "--chdir", LOCAL_ROOT, "--", node];
  if (check === "adapter-tests") args.push("node_modules/vitest/vitest.mjs", "run", "tests/concord-local-adapter.test.ts", "--maxWorkers", "1", "--no-cache", "--configLoader", "native", "--fsModuleCachePath", `${LOCAL_ROOT}/.concord/test-harness/compiler/vitest`);
  else if (check === "durable-worker") args.push("--import", "tsx", "scripts/concord-durable-worker.ts");
  else args.push("--import", "tsx", "scripts/concord-isolation-probe.ts", witness!);
  return args;
}

/** Private writable tmpfs is discarded on exit; no host checkpoint persistence claimed. */
export async function runIsolatedConcordCheck(check: IsolatedCheck, witness?: string): Promise<CheckResult> {
  const args = isolatedCheckArguments(check, witness);
  return await new Promise((resolve, reject) => {
    const child = spawn("/usr/bin/bwrap", args, { cwd: LOCAL_ROOT, env: { NODE_ENV: "test" }, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "", bytes = 0, failed = false;
    const kill = () => { if (child.pid) { try { process.kill(-child.pid, "SIGKILL"); } catch { /* Already gone. */ } } };
    const timer = setTimeout(() => { failed = true; kill(); }, 120000);
    const capture = (chunk: Buffer, error: boolean) => {
      bytes += chunk.byteLength;
      if (bytes > MAX_OUTPUT) { failed = true; kill(); return; }
      if (error) stderr += chunk.toString("utf8"); else stdout += chunk.toString("utf8");
    };
    child.stdout.on("data", (chunk: Buffer) => capture(chunk, false));
    child.stderr.on("data", (chunk: Buffer) => capture(chunk, true));
    child.once("error", () => { failed = true; });
    child.once("close", exitCode => {
      clearTimeout(timer);
      if (failed) reject(new Error("Isolated check unavailable")); else resolve({ exitCode, stdout, stderr });
    });
  });
}
