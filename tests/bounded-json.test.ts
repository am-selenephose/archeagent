import { afterEach, describe, expect, it, vi } from "vitest";
import { BodyInputError, readBoundedJson } from "../src/server/http/bounded-json";

function streamed(body: ReadableStream<Uint8Array>, signal?: AbortSignal, length?: string) {
  return new Request("http://127.0.0.1:34686/api/evaluate", {
    method: "POST", body, signal, duplex: "half",
    headers: length ? { "content-length": length } : {},
  } as RequestInit);
}
afterEach(() => vi.useRealTimers());

describe("bounded JSON acquisition", () => {
  it("accepts exactly the actual byte limit", async () => {
    const request = new Request("http://127.0.0.1:34686/test", { method: "POST", body: "{}      " });
    expect(await readBoundedJson(request, 8, 1000)).toEqual({});
  });
  it("rejects actual multibyte size even with a forged short length and cancels", async () => {
    let canceled = false;
    const body = new ReadableStream<Uint8Array>({
      start(c) { c.enqueue(new TextEncoder().encode('{"x":"£££"}')); },
      cancel() { canceled = true; },
    });
    await expect(readBoundedJson(streamed(body, undefined, "1"), 10, 1000)).rejects.toMatchObject({ code: "too_large" });
    expect(canceled).toBe(true);
  });
  it("times out a never-settling stream and cancels without awaiting cancellation", async () => {
    vi.useFakeTimers();
    let canceled = false;
    const body = new ReadableStream<Uint8Array>({ cancel() { canceled = true; return new Promise<void>(() => {}); } });
    const pending = readBoundedJson(streamed(body), 32, 50);
    const assertion = expect(pending).rejects.toMatchObject({ code: "timeout" });
    await vi.advanceTimersByTimeAsync(50);
    await assertion;
    expect(canceled).toBe(true);
  });
  it("rejects a canceled request without exposing its reason", async () => {
    const abort = new AbortController();
    const body = new ReadableStream<Uint8Array>();
    const pending = readBoundedJson(streamed(body, abort.signal), 32, 1000);
    const assertion = expect(pending).rejects.toMatchObject({ code: "cancelled", message: "Request body unavailable" });
    abort.abort(new Error("PRIVATE_SENTINEL"));
    await assertion;
  });
  it.each([new Uint8Array([0xff]), new TextEncoder().encode('{}{}'), new TextEncoder().encode('{"PRIVATE_SENTINEL"')])(
    "rejects malformed UTF8 or incomplete/multiple JSON without echo", async (bytes) => {
      const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bytes); c.close(); } });
      await expect(readBoundedJson(streamed(body), 128, 1000)).rejects.toMatchObject({ code: "malformed", message: "Request body unavailable" });
    },
  );
  it("accepts a UTF8 code point split across chunks", async () => {
    const bytes = new TextEncoder().encode('{"value":"🦊"}');
    const split = bytes.indexOf(0xf0) + 1;
    const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bytes.slice(0, split)); c.enqueue(bytes.slice(split)); c.close(); } });
    expect(await readBoundedJson(streamed(body), 64, 1000)).toEqual({ value: "🦊" });
  });
  it("rejects an endless empty-chunk stream rather than starving the deadline", async () => {
    const body = new ReadableStream<Uint8Array>({ pull(c) { c.enqueue(new Uint8Array()); } });
    await expect(readBoundedJson(streamed(body), 32, 1000)).rejects.toBeInstanceOf(BodyInputError);
  });
});
