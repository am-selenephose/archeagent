import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { LOCAL_ROOT } from "./local-paths";
export interface ReceiptCommand { executable: string; args: string[]; cwd: string; timeoutMs: number; outputBytes: number }
export interface CapturedStream { sha256: string; bytes: number; retained: Buffer; truncated: boolean }
export interface CapturedProcessResult { startedAt: string; finishedAt: string; exitCode: number | null; signal: string | null; outcome: "succeeded" | "failed" | "timed_out" | "truncated" | "spawn_failed"; timedOut: boolean; stdout: CapturedStream; stderr: CapturedStream }
/** Internal process primitive. No HTTP/CLI accepts arbitrary ReceiptCommand JSON. */
export async function runReceiptProcess(command: ReceiptCommand): Promise<CapturedProcessResult> {
  command = { ...command, args: [...command.args] };
  if (!Number.isSafeInteger(command.timeoutMs) || command.timeoutMs < 1 || command.timeoutMs > 300_000 || !Number.isSafeInteger(command.outputBytes) || command.outputBytes < 1 || command.outputBytes > 131_072 || command.cwd !== LOCAL_ROOT || typeof command.executable !== "string" || !command.executable || command.executable.includes("\0") || command.args.length > 32 || command.args.some(arg => typeof arg !== "string" || arg.length > 2048 || arg.includes("\0"))) throw new Error("Receipt check unavailable");
  const startedAt = new Date().toISOString();
  const env: NodeJS.ProcessEnv = { NODE_ENV: "production", CI: "true", NO_COLOR: "1" };
  // Provider credentials and loader/command override variables are not inherited.
  for (const key of ["PATH", "HOME", "LANG", "LC_ALL", "TZ", "TMPDIR", "PNPM_HOME", "XDG_CACHE_HOME"]) if (process.env[key]) env[key] = process.env[key];
  return await new Promise<CapturedProcessResult>((resolve) => {
    let timedOut = false; let spawnFailed = false; let completed = false;
    const child = spawn(command.executable, [...command.args], { cwd: LOCAL_ROOT, env, shell: false, detached: process.platform === "linux", stdio: ["ignore", "pipe", "pipe"] });
    function terminate() {
      if (!child.pid) return;
      try { if (process.platform === "linux") process.kill(-child.pid, "SIGKILL"); else child.kill("SIGKILL"); } catch { /* An already-exited process is harmless. */ }
    }
    const capture = () => ({ hash: createHash("sha256"), bytes: 0, retainedBytes: 0, chunks: [] as Buffer[], truncated: false });
    const stdout = capture(); const stderr = capture();
    function ingest(stream: ReturnType<typeof capture>, bytes: Buffer) {
      stream.hash.update(bytes); stream.bytes += bytes.length;
      const keep = Math.min(command.outputBytes - stream.retainedBytes, bytes.length);
      if (keep > 0) { stream.chunks.push(Buffer.from(bytes.subarray(0, keep))); stream.retainedBytes += keep; }
      if (stream.bytes > command.outputBytes) { stream.truncated = true; terminate(); }
    }
    child.stdout.on("data", (chunk: Buffer) => ingest(stdout, chunk));
    child.stderr.on("data", (chunk: Buffer) => ingest(stderr, chunk));
    const timer = setTimeout(() => { timedOut = true; terminate(); }, command.timeoutMs);
    child.on("error", () => { spawnFailed = true; });
    child.on("close", (exitCode, signal) => {
      if (completed) return; completed = true; clearTimeout(timer);
      const finish = (stream: ReturnType<typeof capture>): CapturedStream => ({ sha256: stream.hash.digest("hex"), bytes: stream.bytes, retained: Buffer.concat(stream.chunks, stream.retainedBytes), truncated: stream.truncated });
      const outcome = timedOut ? "timed_out" : stdout.truncated || stderr.truncated ? "truncated" : spawnFailed ? "spawn_failed" : exitCode === 0 && signal === null ? "succeeded" : "failed";
      resolve({ startedAt, finishedAt: new Date().toISOString(), exitCode, signal, outcome, timedOut, stdout: finish(stdout), stderr: finish(stderr) });
    });
  });
}
