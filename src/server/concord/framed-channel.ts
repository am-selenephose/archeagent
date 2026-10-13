import { EventEmitter } from "node:events";
import type { Readable, Writable } from "node:stream";
/** Fixed binary lengths; never accumulate an unbounded line/request. */
export class FramedChannel extends EventEmitter {
  private buffer: Buffer = Buffer.alloc(0);
  constructor(private readonly output: Writable, input: Readable, private readonly maximum: number) {
    super();
    input.on("data", (chunk: Buffer) => {
      try {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        while (this.buffer.length >= 4) {
          const length = this.buffer.readUInt32BE(0);
          if (!length || length > maximum) throw new Error("IPC frame rejected");
          if (this.buffer.length < length + 4) break;
          const frame = Buffer.from(this.buffer.subarray(4, length + 4)); this.buffer = this.buffer.subarray(length + 4);
          this.emit("frame", frame);
        }
        if (this.buffer.length > maximum + 4) throw new Error("IPC frame rejected");
      } catch { this.emit("failure", new Error("IPC frame rejected")); }
    });
    input.on("end", () => this.emit("failure", new Error("IPC channel ended")));
    input.on("error", () => this.emit("failure", new Error("IPC channel failed")));
    output.on("error", () => this.emit("failure", new Error("IPC channel failed")));
  }
  async send(frame: Buffer): Promise<void> {
    if (!frame.length || frame.length > this.maximum) throw new Error("IPC frame rejected");
    const header = Buffer.alloc(4); header.writeUInt32BE(frame.length);
    await new Promise<void>((resolve, reject) => this.output.write(Buffer.concat([header, frame]), error => error ? reject(error) : resolve()));
  }
}
