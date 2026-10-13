import { describe, expect, it } from "vitest";
import { PassThrough } from "node:stream";
import { FramedChannel } from "../src/server/concord/framed-channel";
import { parseBundle } from "../src/server/concord/durable-protocol";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { isolatedCheckArguments } from "../src/server/concord/isolated-process";
import { LOCAL_ROOT } from "../src/server/concord/local-paths";

function wire(kind: number, body = Buffer.alloc(0)) {
  const payload = Buffer.concat([Buffer.from([kind]), body]), header = Buffer.alloc(4);
  header.writeUInt32BE(payload.length); return Buffer.concat([header, payload]);
}
describe("independent IPC negative controls", () => {
  it("refuses oversized declared frames before waiting for their body", () => {
    const input = new PassThrough(), output = new PassThrough(); const channel = new FramedChannel(output, input, 64);
    let rejected = false; channel.on("failure", () => { rejected = true; });
    const header = Buffer.alloc(4); header.writeUInt32BE(0x7fffffff); input.write(header); expect(rejected).toBe(true);
  });
  it("reassembles fragmented frames and rejects zero-length protocol input", () => {
    const input = new PassThrough(), output = new PassThrough(); const channel = new FramedChannel(output, input, 64);
    const seen: Buffer[] = []; let failures = 0; channel.on("frame", frame => seen.push(frame)); channel.on("failure", () => { failures++; });
    const bytes = Buffer.from([0, 0, 0, 3, 1, 2, 3]); input.write(bytes.subarray(0, 2)); input.write(bytes.subarray(2, 5)); input.write(bytes.subarray(5));
    expect(seen).toEqual([Buffer.from([1, 2, 3])]); input.write(Buffer.alloc(4)); expect(failures).toBe(1);
  });
  it("rejects caller JSON success as a restore bundle", () => {
    expect(() => parseBundle(Buffer.from(JSON.stringify({ success: true, durable: true, filename: "../../outside.sqlite", releaseAuthorized: true })))).toThrow();
  });
  it.each(["invalid-json", "extra-field", "unknown-kind"])("fences already queued worker requests after %s rejection", async (kind) => {
    const child = spawn("/usr/bin/bwrap", isolatedCheckArguments("durable-worker"), { cwd: LOCAL_ROOT, env: { NODE_ENV: "test" }, stdio: ["pipe", "pipe", "pipe"], detached: true });
    const replies: Buffer[] = []; let timedOut = false;
    const channel = new FramedChannel(child.stdin, child.stdout, 48 * 1024 * 1024 + 1024);
    channel.on("frame", bytes => replies.push(bytes)); channel.on("failure", () => { /* Assert the real process outcome. */ });
    child.stderr.on("data", () => { /* Never expose private bodies. */ });
    const finished = new Promise<number | null>((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
    const timer = setTimeout(() => { timedOut = true; if (child.pid) { try { process.kill(-child.pid, "SIGKILL"); } catch { /* Own child ended. */ } } }, 10000);
    const valid = Buffer.from(JSON.stringify({ op: "call", actor: "builder", id: randomUUID(), tool: "start_work", args: { task_id: "must-not-run", title: "Must not run", kind: "codex" } }));
    const invalid = kind === "unknown-kind" ? wire(255) : wire(1, kind === "invalid-json" ? Buffer.from("{") : Buffer.from(JSON.stringify({ op: "call", actor: "builder", id: randomUUID(), tool: "start_work", args: {}, releaseAuthorized: true })));
    try {
      child.stdin.write(Buffer.concat([wire(0), invalid, wire(1, valid)]));
      expect(await finished).toBe(1); expect(timedOut).toBe(false);
      // INIT is the only allowed success. A queued valid operation must neither
      // run nor produce its result/snapshot after the prior protocol failure.
      expect(replies).toHaveLength(1);
      expect(JSON.parse(replies[0].subarray(1).toString()).version).toBe("archeagent.durable-state.v1");
    } finally { clearTimeout(timer); }
  }, 15000);
});
