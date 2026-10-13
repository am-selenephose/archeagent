import { setImmediate as yieldToIO } from "node:timers/promises";

export class BodyInputError extends Error {
  constructor(public readonly code: "too_large" | "timeout" | "cancelled" | "malformed") {
    super("Request body unavailable");
    this.name = "BodyInputError";
  }
}

/** Counts acquired bytes, not the untrusted Content-Length header. */
export async function readBoundedJson(request: Request, maxBytes: number, deadlineMs: number): Promise<unknown> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || !Number.isSafeInteger(deadlineMs) || deadlineMs < 1) throw new BodyInputError("malformed");
  if (request.signal.aborted) throw new BodyInputError("cancelled");
  if (!request.body) throw new BodyInputError("malformed");
  const reader = request.body.getReader();
  let fail!: (error: BodyInputError) => void;
  const deadline = new Promise<never>((_, reject) => { fail = reject; });
  const onAbort = () => fail(new BodyInputError("cancelled"));
  request.signal.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => fail(new BodyInputError("timeout")), deadlineMs);
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let reads = 0;
  let emptyChunks = 0;
  try {
    for (;;) {
      const { value, done } = await Promise.race([reader.read(), deadline]);
      if (done) break;
      if (!(value instanceof Uint8Array)) throw new BodyInputError("malformed");
      if (++reads % 64 === 0) await Promise.race([yieldToIO(), deadline]);
      if (value.byteLength === 0) {
        // Empty chunks cannot consume unlimited CPU while starving the timer.
        if (++emptyChunks > 1024) throw new BodyInputError("malformed");
        continue;
      }
      bytes += value.byteLength;
      if (bytes > maxBytes) throw new BodyInputError("too_large");
      chunks.push(value.slice());
    }
    const payload = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) { payload.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(payload)) as unknown;
  } catch (error) {
    // Cancellation itself may never settle; do not let it extend the body deadline.
    void reader.cancel().catch(() => {});
    throw error instanceof BodyInputError ? error : new BodyInputError("malformed");
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener("abort", onAbort);
    try { reader.releaseLock(); } catch { /* A pending canceled read owns the lock until it settles. */ }
  }
}
