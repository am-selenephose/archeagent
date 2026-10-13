/** Real native recovery with a test-only libc fault, not agent evidence. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { LOCAL_ROOT } from "../src/server/concord/local-paths";
import { FramedChannel } from "../src/server/concord/framed-channel";

let binaries: string;
beforeAll(() => {
  binaries = mkdtempSync(join(LOCAL_ROOT, ".local-audit/native-io-test-"));
  for (const args of [
    ["-std=c11", "-Wall", "-Wextra", "-Werror", "native/concord-persistence.c", "-lcrypto", "-o", join(binaries, "broker")],
    ["-shared", "-fPIC", "-Wall", "-Wextra", "-Werror", "tests/fixtures/concord-readdir-fault.c", "-ldl", "-o", join(binaries, "fault.so")],
  ]) {
    const compiled = spawnSync("cc", args, { cwd: LOCAL_ROOT, encoding: "utf8", timeout: 10000 });
    expect(compiled.status, compiled.stdout + compiled.stderr).toBe(0);
  }
});
afterAll(() => { if (binaries) rmSync(binaries, { recursive: true, force: true }); });

async function native(store: string, frames: Buffer[], fault: boolean) {
  // Disposable fixed store only. This harness probes native enumeration errors;
  // the descriptor-acquisition launcher has its own independent isolation tests.
  const args = ["--unshare-all", "--unshare-user", "--die-with-parent", "--new-session", "--disable-userns", "--cap-drop", "ALL", "--clearenv",
    ...(fault ? ["--setenv", "LD_PRELOAD", join(binaries, "fault.so")] : []),
    "--ro-bind", "/usr", "/usr", "--ro-bind", "/lib", "/lib", "--ro-bind", "/lib64", "/lib64", "--ro-bind", LOCAL_ROOT, LOCAL_ROOT,
    "--tmpfs", join(LOCAL_ROOT, ".concord"), "--perms", "0700", "--dir", join(LOCAL_ROOT, ".concord/publisher"), "--bind", store, join(LOCAL_ROOT, ".concord/publisher"),
    "--remount-ro", join(LOCAL_ROOT, ".concord"), "--proc", "/proc", "--remount-ro", "/proc", "--remount-ro", "/", "--chdir", LOCAL_ROOT, "--", join(binaries, "broker")];
  const child = spawn("/usr/bin/bwrap", args, { cwd: LOCAL_ROOT, detached: true, stdio: ["pipe", "pipe", "pipe"] });
  const replies: Buffer[] = [];
  let stderr = "", killed = false;
  const channel = new FramedChannel(child.stdin, child.stdout, 24 * 1024 * 1024 + 1024);
  channel.on("frame", frame => replies.push(frame)); channel.on("failure", () => { /* Exit is asserted below. */ });
  child.stderr.on("data", bytes => { stderr += bytes.toString(); });
  const finished = new Promise<number | null>((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
  const timer = setTimeout(() => { killed = true; if (child.pid) { try { process.kill(-child.pid, "SIGKILL"); } catch { /* Own child ended. */ } } }, 10000);
  try {
    for (const frame of frames) await channel.send(frame);
    child.stdin.end();
    return { exit: await finished, replies, stderr, killed };
  } finally { clearTimeout(timer); }
}

describe("native recovery filesystem failures", () => {
  it("refuses an EIO-truncated directory scan rather than returning an acknowledged older prefix", async () => {
    const parent = join(LOCAL_ROOT, ".concord/test-harness"); mkdirSync(parent, { recursive: true, mode: 0o700 });
    const store = mkdtempSync(join(parent, "durable-store-io-error-"));
    try {
      const seeded = await native(store, [Buffer.from([0]), Buffer.concat([Buffer.from([1]), Buffer.from("OLD_SYNTHETIC_STATE")]), Buffer.concat([Buffer.from([1]), Buffer.from("NEW_ACKNOWLEDGED_SYNTHETIC_STATE")])], false);
      expect(seeded.exit).toBe(0); expect(seeded.killed).toBe(false);
      expect(seeded.replies[2].subarray(1).readBigUInt64BE()).toBe(BigInt(2));
      const before = readdirSync(store).sort().map(name => [name, createHash("sha256").update(readFileSync(join(store, name))).digest("hex")]);
      const refused = await native(store, [Buffer.from([0])], true);
      expect(refused.stderr).toContain("TEST_READDIR_EIO"); expect(refused.killed).toBe(false);
      expect(refused.exit).toBe(1); expect(refused.replies).toHaveLength(0);
      expect(readdirSync(store).sort().map(name => [name, createHash("sha256").update(readFileSync(join(store, name))).digest("hex")])).toEqual(before);
      const recovered = await native(store, [Buffer.from([0])], false);
      expect(recovered.exit).toBe(0);
      expect(recovered.replies[0].subarray(1).readBigUInt64BE()).toBe(BigInt(2));
      expect(recovered.replies[0].subarray(9).toString()).toBe("NEW_ACKNOWLEDGED_SYNTHETIC_STATE");
    } finally { rmSync(store, { recursive: true, force: true }); }
  }, 30000);
});
