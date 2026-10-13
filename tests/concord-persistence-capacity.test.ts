/** Existing-limit characterization, not independent-review or model evidence. */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, readdirSync, lstatSync, rmSync } from "node:fs";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { join } from "node:path";
import Database from "better-sqlite3";
import { LOCAL_ROOT } from "../src/server/concord/local-paths";
import { FramedChannel } from "../src/server/concord/framed-channel";
import { publisherArguments, DurableConcordSupervisor } from "../src/server/concord/durable-supervisor";

const fixtures: string[] = [], brokers: FixtureBroker[] = [], supervisors: DurableConcordSupervisor[] = [];
function fixture(): string {
  const parent = join(LOCAL_ROOT, ".concord/test-harness"); mkdirSync(parent, { recursive: true, mode: 0o700 });
  const dir = mkdtempSync(join(parent, "durable-store-capacity-")); fixtures.push(dir); return dir;
}
/** Test-owned binary IPC only; the actual native broker runs unmodified. */
class FixtureBroker {
  private child: ChildProcessWithoutNullStreams;
  private channel: FramedChannel;
  private finished: Promise<void>;
  private pending?: { resolve: (data: Buffer) => void; reject: (error: Error) => void; timer: NodeJS.Timeout };
  constructor(store: string) {
    this.child = spawn(join(LOCAL_ROOT, ".local-audit/native-persistence/launcher"), publisherArguments(store), { cwd: LOCAL_ROOT, stdio: ["pipe", "pipe", "pipe"], detached: true, env: { NODE_ENV: "test" } });
    this.finished = new Promise(resolve => this.child.once("close", () => resolve()));
    this.channel = new FramedChannel(this.child.stdin, this.child.stdout, 24 * 1024 * 1024 + 32);
    const refuse = () => {
      if (this.pending) { clearTimeout(this.pending.timer); this.pending.reject(new Error("Native operation refused without ACK")); this.pending = undefined; }
    };
    this.channel.on("failure", refuse); this.child.on("error", refuse);
    this.child.stderr.on("data", () => { /* Generic native diagnostic is not task evidence. */ });
    this.channel.on("frame", (frame: Buffer) => {
      if (!this.pending || frame[0] !== 0) { refuse(); return; }
      const request = this.pending; this.pending = undefined; clearTimeout(request.timer); request.resolve(frame.subarray(1));
    });
    brokers.push(this);
  }
  async request(kind: number, body: Buffer = Buffer.alloc(0)): Promise<Buffer> {
    if (this.pending || this.child.exitCode !== null || this.child.signalCode !== null) throw new Error("Native operation refused without ACK");
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { reject(new Error("Native request deadline")); void this.close(); }, 15000);
      this.pending = { resolve, reject, timer };
      void this.channel.send(Buffer.concat([Buffer.from([kind]), body])).catch(reject);
    });
  }
  async close(): Promise<void> {
    if (this.child.exitCode === null && this.child.signalCode === null && this.child.pid) {
      try { process.kill(-this.child.pid, "SIGKILL"); } catch { /* Own process already closed. */ }
    }
    await this.finished;
  }
}
beforeAll(() => {
  const result = spawnSync(process.execPath, ["scripts/build-concord-persistence.mjs"], { cwd: LOCAL_ROOT, encoding: "utf8", timeout: 10000 });
  expect(result.status, result.stdout + result.stderr).toBe(0);
});
afterEach(async () => {
  for (const supervisor of supervisors.splice(0)) await supervisor.close();
  for (const broker of brokers.splice(0)) await broker.close();
  for (const dir of fixtures.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("real capacity limits with owned synthetic fixtures", () => {
  it("publishes generation 512 but refuses 513 without replacing or deleting history", async () => {
    const store = fixture(), broker = new FixtureBroker(store);
    expect((await broker.request(0)).readBigUInt64BE()).toBe(BigInt(0));
    const payload = Buffer.from("SYNTHETIC_OPAQUE_NATIVE_CAPACITY_PAYLOAD");
    for (let generation = 1; generation <= 512; generation++) {
      const ack = await broker.request(1, payload);
      expect(ack.length).toBe(40); expect(ack.readBigUInt64BE()).toBe(BigInt(generation));
    }
    const before = readdirSync(store).sort();
    expect(before.filter(name => name.endsWith(".snap"))).toHaveLength(512);
    const last = join(store, "00000000000000000512.snap"), bytes = readFileSync(last);
    await expect(broker.request(1, payload)).rejects.toThrow("without ACK");
    expect(readdirSync(store).sort()).toEqual(before); expect(readFileSync(last)).toEqual(bytes);
    await broker.close();
    const recovered = new FixtureBroker(store), snapshot = await recovered.request(0);
    expect(snapshot.readBigUInt64BE()).toBe(BigInt(512)); expect(snapshot.subarray(8).equals(payload)).toBe(true);
  }, 30000);

  it("publishes exactly 256 MiB of generation records and refuses one more byte of payload without loss", async () => {
    const store = fixture(), broker = new FixtureBroker(store);
    await broker.request(0);
    // Native record overhead is 52 header + 32 HMAC bytes. This tests native
    // byte accounting with opaque payloads, not restore of a fake SQLite image.
    const maximumPayload = 24 * 1024 * 1024;
    const payload = Buffer.alloc(maximumPayload, 0x53);
    for (let generation = 1; generation <= 10; generation++) expect((await broker.request(1, payload)).readBigUInt64BE()).toBe(BigInt(generation));
    const remainderPayload = 256 * 1024 * 1024 - 10 * (maximumPayload + 84) - 84;
    const finalPayload = Buffer.alloc(remainderPayload, 0x46);
    expect((await broker.request(1, finalPayload)).readBigUInt64BE()).toBe(BigInt(11));
    const names = readdirSync(store).sort();
    expect(names.filter(name => name.endsWith(".snap")).reduce((sum, name) => sum + lstatSync(join(store, name)).size, 0)).toBe(268435456);
    const last = join(store, "00000000000000000011.snap");
    const hash = createHash("sha256").update(readFileSync(last)).digest("hex");
    await expect(broker.request(1, Buffer.from([0x58]))).rejects.toThrow("without ACK");
    expect(readdirSync(store).sort()).toEqual(names);
    expect(createHash("sha256").update(readFileSync(last)).digest("hex")).toBe(hash);
    await broker.close();
    const recovered = new FixtureBroker(store), snapshot = await recovered.request(0);
    expect(snapshot.readBigUInt64BE()).toBe(BigInt(11));
    expect(snapshot.length).toBe(8 + finalPayload.length);
    // Byte equality is checked by Buffer.equals without materializing millions
    // of per-byte assertion properties inside the test framework.
    expect(snapshot.subarray(8).equals(finalPayload)).toBe(true);
  }, 30000);

  it("accepts retry record 10000, refuses a new request at capacity, and still replays the exact acknowledged request after recovery", async () => {
    const store = fixture();
    const initial = await DurableConcordSupervisor.open(store, ["builder"], { initialize: true }); supervisors.push(initial); await initial.close();
    const filename = join(store, "00000000000000000001.snap");
    const record = readFileSync(filename), bundle = JSON.parse(record.subarray(52, record.length - 32).toString());
    const image = Buffer.from(bundle.recorder, "base64"); image[18] = 1; image[19] = 1;
    const companion = new Database(image);
    try {
      const insert = companion.prepare("INSERT INTO durable_ipc_requests VALUES(?,?,?,?,?)");
      const digest = createHash("sha256").update(JSON.stringify({ actor: "builder", tool: "inspect_work", args: {} })).digest("hex");
      companion.transaction(() => {
        for (let i = 0; i < 9999; i++) insert.run(randomUUID(), "builder", "inspect_work", digest, JSON.stringify({ content: [{ type: "text", text: "SYNTHETIC_RETRY_FIXTURE" }] }));
      })();
      bundle.recorder = companion.serialize().toString("base64");
    } finally { companion.close(); }
    // Manufacture only owned seeded fixture data. These 9999 rows are not
    // claimed as real requests, acknowledgements, transcripts or model sessions.
    const payload = Buffer.from(JSON.stringify(bundle)), header = Buffer.from(record.subarray(0, 52)); header.writeUInt32BE(payload.length, 48);
    const unsigned = Buffer.concat([header, payload]);
    const signature = createHmac("sha256", readFileSync(join(store, "authority.key"))).update(unsigned).digest();
    writeFileSync(filename, Buffer.concat([unsigned, signature]));
    const recovered = await DurableConcordSupervisor.open(store, ["builder"]); supervisors.push(recovered);
    expect((await recovered.auditMetadata()).retryCount).toBe(9999);
    const actor = recovered.client("builder"), id = randomUUID();
    const acknowledged = await actor.call("inspect_work", {}, id);
    expect(acknowledged.acknowledgement.durable).toBe(true);
    expect((await recovered.auditMetadata()).retryCount).toBe(10000);
    const before = readdirSync(store).sort();
    await expect(actor.call("start_work", { task_id: "must-not-enter", title: "Must not enter", kind: "codex" })).rejects.toThrow();
    expect(readdirSync(store).sort()).toEqual(before);
    await recovered.restart();
    expect((await recovered.auditMetadata()).retryCount).toBe(10000);
    const retry = await actor.call("inspect_work", {}, id);
    expect(retry.result).toEqual(acknowledged.result);
    expect((await recovered.auditMetadata()).retryCount).toBe(10000);
    expect((await recovered.auditMetadata()).sourceRevision.taskCount).toBe(0);
  }, 30000);
});
