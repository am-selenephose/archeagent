import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { lstatSync, realpathSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { FramedChannel } from "./framed-channel";
import { isolatedCheckArguments } from "./isolated-process";
import { LOCAL_ROOT, validateLocalPaths, type LocalPaths } from "./local-paths";
import { actorSchema, MAX_REQUEST, MAX_SNAPSHOT, operationSchema, parseBundle, auditMetadataSchema, type DurableOperation } from "./durable-protocol";

type FrameResult = { body: Buffer };
class PrivateProcess {
  readonly child: ChildProcessWithoutNullStreams;
  private readonly channel: FramedChannel;
  private pending?: { resolve: (result: FrameResult) => void; reject: (error: Error) => void; timer: NodeJS.Timeout };
  private ended = false;
  onStage?: (stage: string) => void;
  constructor(args: string[], executable = "/usr/bin/bwrap") {
    this.child = spawn(executable, args, { cwd: LOCAL_ROOT, env: { NODE_ENV: "test" }, stdio: ["pipe", "pipe", "pipe"], detached: true });
    this.channel = new FramedChannel(this.child.stdin, this.child.stdout, MAX_SNAPSHOT * 2 + 1024);
    this.channel.on("frame", (frame: Buffer) => {
      if (frame[0] === 2) { this.onStage?.(frame.subarray(1).toString("utf8")); return; }
      if (frame[0] !== 0 || !this.pending) { this.kill(); return; }
      const pending = this.pending; this.pending = undefined; clearTimeout(pending.timer); pending.resolve({ body: frame.subarray(1) });
    });
    this.channel.on("failure", () => this.kill());
    this.child.once("error", () => this.kill()); this.child.once("exit", () => this.kill());
    // Bound and discard private diagnostics; never return native stderr as task evidence.
    let diagnosticBytes = 0;
    this.child.stderr.on("data", (chunk: Buffer) => { diagnosticBytes += chunk.length; if (diagnosticBytes > 16384) this.kill(); });
  }
  async request(kind: number, body: Buffer = Buffer.alloc(0)): Promise<Buffer> {
    if (this.ended || this.pending) throw new Error("Private IPC unavailable");
    return await new Promise<Buffer>((resolve, reject) => {
      const timer = setTimeout(() => this.kill(), 15000);
      this.pending = { resolve: result => resolve(result.body), reject, timer };
      void this.channel.send(Buffer.concat([Buffer.from([kind]), body])).catch(() => this.kill());
    });
  }
  kill(): void {
    if (this.ended) return; this.ended = true;
    if (this.child.pid) { try { process.kill(-this.child.pid, "SIGKILL"); } catch { /* Already closed. */ } }
    if (this.pending) { clearTimeout(this.pending.timer); this.pending.reject(new Error("Durable operation unacknowledged; recover before retry")); this.pending = undefined; }
  }
  async close(): Promise<void> {
    if (this.child.exitCode !== null || this.child.signalCode !== null) return;
    const ended = new Promise<void>(resolve => this.child.once("close", resolve)); this.kill(); await ended;
  }
}

export function publisherArguments(storeDir: string, pause?: 1 | 2 | 3): string[] {
  const relative = storeDir.slice(`${LOCAL_ROOT}/.concord/test-harness/`.length);
  if (!storeDir.startsWith(`${LOCAL_ROOT}/.concord/test-harness/`) || !/^durable-store-[a-zA-Z0-9_-]{1,80}$/.test(relative)) throw new Error("Persistence scope rejected");
  const paths: LocalPaths = { rootDir: LOCAL_ROOT, stateDir: storeDir, concordDb: join(storeDir, "concord.sqlite"), recorderDb: join(storeDir, "recorder.sqlite"), sourceFile: join(storeDir, "source.json") };
  validateLocalPaths(paths);
  if (realpathSync(storeDir) !== storeDir || (lstatSync(storeDir).mode & 0o777) !== 0o700) throw new Error("Persistence scope rejected");
  for (const name of ["broker", "launcher"]) {
    const binary = `${LOCAL_ROOT}/.local-audit/native-persistence/${name}`;
    const stat = lstatSync(binary);
    if (realpathSync(binary) !== binary || !stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid?.() || (stat.mode & 0o6000)) throw new Error("Native broker unavailable");
  }
  // Broker is a separate non-SQLite process. Its only writable host mount is
  // the approved snapshot directory; SQLite never inherits it or its FDs.
  const inode = lstatSync(storeDir, { bigint: true });
  return [relative, inode.dev.toString(), inode.ino.toString(), ...(pause ? [String(pause)] : [])];
}

export type DurableReply = { result: unknown; acknowledgement: { durable: true; generation: number; checkpointDigest: string; sourceInstanceId: string; captureRunId: string; requestId: string; actorId: string; provenance: "scripted_protocol_test"; releaseAuthorized: false } };
/** Operator-owned local supervisor. Client capability, NOT an actor in caller JSON,
 * selects the actor. Private stdio is multiplexed; no public listener/socket. */
export class DurableConcordSupervisor {
  private publisher?: PrivateProcess;
  private worker?: PrivateProcess;
  private queue: Promise<unknown> = Promise.resolve();
  private failed = false;
  private closed = false;
  private closing?: Promise<void>;
  private identity?: { sourceInstanceId: string; captureRunId: string };
  private generation = 0;
  private waiting = 0;
  private beforeCheckpoint?: () => void;
  private storeIdentity?: { device: string; inode: string };
  private constructor(private readonly storeDir: string, private readonly actors: Set<string>) {}
  static async open(storeDir: string, actors: string[], options: { initialize?: boolean; minimumGeneration?: number } = {}): Promise<DurableConcordSupervisor> {
    if (!actors.length || actors.length > 16 || new Set(actors).size !== actors.length) throw new Error("Actor policy rejected");
    actors.forEach(actor => actorSchema.parse(actor));
    if (options.initialize && readdirSync(storeDir).length) throw new Error("Initialization refuses existing store");
    const supervisor = new DurableConcordSupervisor(storeDir, new Set(actors));
    try { await supervisor.recover(options.initialize === true, options.minimumGeneration ?? 1); return supervisor; }
    catch (error) { await supervisor.close(); throw error; }
  }
  private async recover(initialize: boolean, minimum: number) {
    if (this.closed) throw new Error("Durable supervisor closed");
    if (!Number.isSafeInteger(minimum) || minimum < 1) throw new Error("Recovery floor rejected");
    const args = publisherArguments(this.storeDir);
    const acquired = { device: args[1], inode: args[2] };
    if (this.storeIdentity && (this.storeIdentity.device !== acquired.device || this.storeIdentity.inode !== acquired.inode)) throw new Error("Persistence store identity changed");
    this.storeIdentity ??= acquired;
    // The native launcher independently checks this exact inode at acquisition.
    // A restarted object must not create key/lock metadata in a substituted root.
    this.publisher = new PrivateProcess(args, `${LOCAL_ROOT}/.local-audit/native-persistence/launcher`);
    const stored = await this.publisher.request(0);
    if (stored.length < 8) throw new Error("Recovery response rejected");
    const generation = Number(stored.readBigUInt64BE(0));
    if ((!initialize && generation < minimum) || (initialize && generation !== 0)) throw new Error("Rollback or partial store rejected");
    const payload = stored.subarray(8);
    if (generation) parseBundle(payload);
    this.worker = new PrivateProcess(isolatedCheckArguments("durable-worker"));
    const snapshot = await this.worker.request(0, payload);
    const bundle = parseBundle(snapshot); this.identity = bundle.identity; this.generation = generation;
    if (!generation) this.generation = (await this.publish(snapshot)).generation;
    this.failed = false;
  }
  private async publish(snapshot: Buffer) {
    parseBundle(snapshot);
    const ack = await this.publisher!.request(1, snapshot);
    if (ack.length !== 40) throw new Error("Persistence acknowledgement rejected");
    const generation = Number(ack.readBigUInt64BE(0));
    if (generation !== this.generation + 1) throw new Error("Checkpoint sequence rejected");
    this.generation = generation;
    return { generation, checkpointDigest: ack.subarray(8).toString("hex") };
  }
  client(actor: string) {
    if (this.closed) throw new Error("Durable supervisor closed");
    if (!this.actors.has(actor)) throw new Error("Actor capability denied");
    return Object.freeze({ call: (tool: DurableOperation["tool"], args: Record<string, unknown>, requestId = randomUUID()) => this.call({ op: "call", actor, id: requestId, tool, args }) });
  }
  /** Fixed operator metadata projection; no SQL selector or private bodies. */
  async auditMetadata() {
    if (this.closed) throw new Error("Durable supervisor closed");
    if (this.waiting >= 64) throw new Error("IPC queue bound exceeded");
    this.waiting++;
    const pending = this.queue.catch(() => undefined).then(async () => {
      if (this.failed || !this.worker) throw new Error("Durable supervisor held");
      const bytes = await this.worker.request(2);
      return auditMetadataSchema.parse(JSON.parse(bytes.toString("utf8")));
    });
    this.queue = pending;
    try { return await pending; } finally { this.waiting--; }
  }
  private async call(request: DurableOperation): Promise<DurableReply> {
    if (this.closed) throw new Error("Durable supervisor closed");
    // Validate/copy before queueing; mutation of caller args cannot change identity or execution.
    const payload = Buffer.from(JSON.stringify(operationSchema.parse(request)));
    if (payload.length > MAX_REQUEST) throw new Error("IPC request bound exceeded");
    if (!this.actors.has(request.actor)) throw new Error("Actor capability denied");
    if (this.waiting >= 64) throw new Error("IPC queue bound exceeded");
    this.waiting++;
    const preceding = this.queue;
    const pending = preceding.catch(() => undefined).then(async () => {
      if (this.failed || !this.worker || !this.publisher || !this.identity) throw new Error("Durable supervisor held");
      try {
        const bytes = await this.worker.request(1, payload);
        const reply = JSON.parse(bytes.toString("utf8")) as { result: unknown; snapshot: string; sourceInstanceId: string; captureRunId: string };
        if (reply.sourceInstanceId !== this.identity.sourceInstanceId || reply.captureRunId !== this.identity.captureRunId || typeof reply.snapshot !== "string") throw new Error("Worker source mismatch");
        const snapshot = Buffer.from(reply.snapshot, "base64"); const bundle = parseBundle(snapshot);
        if (bundle.identity.sourceInstanceId !== this.identity.sourceInstanceId || bundle.identity.captureRunId !== this.identity.captureRunId) throw new Error("Checkpoint source mismatch");
        const hook = this.beforeCheckpoint; this.beforeCheckpoint = undefined; hook?.();
        const checkpoint = await this.publish(snapshot);
        return { result: reply.result, acknowledgement: { ...checkpoint, durable: true as const, ...this.identity, requestId: request.id, actorId: request.actor, provenance: "scripted_protocol_test" as const, releaseAuthorized: false as const } };
      } catch (error) { this.failed = true; this.worker?.kill(); throw error; }
    });
    this.queue = pending;
    try { return await pending; } finally { this.waiting--; }
  }
  /** Explicit recovery fences all failed/unacknowledged operations before retry. */
  async restart(): Promise<void> {
    if (this.closed) throw new Error("Durable supervisor closed");
    if (this.waiting >= 64) throw new Error("IPC queue bound exceeded");
    this.waiting++;
    // Install the lifecycle barrier synchronously. A request submitted next
    // must wait for recovery, not overtake teardown on the old worker.
    const pending = this.queue.catch(() => undefined).then(async () => {
      if (this.closed) throw new Error("Durable supervisor closed");
      const floor = this.generation;
      this.failed = true;
      try {
        await this.worker?.close(); await this.publisher?.close(); this.worker = undefined; this.publisher = undefined;
        await this.recover(false, floor);
      } catch (error) {
        this.failed = true;
        await this.worker?.close(); await this.publisher?.close(); this.worker = undefined; this.publisher = undefined;
        throw error;
      }
    });
    this.queue = pending;
    try { await pending; } finally { this.waiting--; }
  }
  /** Fault injection is privileged operator-only in this scripted harness API. */
  terminateWorker(): void { this.failed = true; this.worker?.kill(); }
  testBeforeCheckpoint(hook: () => void): void { this.beforeCheckpoint = hook; }
  async testPublisherCrash(stage: 1 | 2 | 3, notify: () => void): Promise<void> {
    await this.queue.catch(() => undefined); await this.publisher?.close();
    this.publisher = new PrivateProcess(publisherArguments(this.storeDir, stage), `${LOCAL_ROOT}/.local-audit/native-persistence/launcher`);
    this.publisher.onStage = () => { this.publisher?.kill(); notify(); };
    await this.publisher.request(0); // Recover chain before the controlled interrupted PUT.
  }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    // Closing is terminal at admission time. Drain already-admitted work before
    // releasing resources, and never allow restart to resurrect this object.
    this.closed = true;
    this.closing = this.queue.catch(() => undefined).then(async () => {
      this.failed = true;
      await this.worker?.close(); await this.publisher?.close(); this.worker = undefined; this.publisher = undefined;
    });
    return this.closing;
  }
}
