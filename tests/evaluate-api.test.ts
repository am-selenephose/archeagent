import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "../src/app/api/evaluate/route";
import { POST as review } from "../src/app/api/integrations/concord/review-gate/route";

afterEach(() => vi.useRealTimers());
const request = (body: string) => new Request("http://local.invalid/api/evaluate", { method: "POST", body });
describe("reported-evidence HTTP boundaries", () => {
  it("redacts evaluator validation issues rather than reflecting caller text", async () => {
    const response = await POST(request(JSON.stringify({ candidates: [{ id: "PRIVATE_SENTINEL" }] })));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid evaluation request" });
  });
  it("rejects malformed JSON as bounded input, not an internal exception", async () => {
    const response = await POST(request('{"PRIVATE_SENTINEL"'));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Malformed JSON" });
  });
  it("enforces evaluator actual bytes", async () => {
    const response = await POST(request(" ".repeat(262145)));
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "Payload too large" });
  });
  it.each([POST, review])("bounds a stalled request at ten seconds", async (handler) => {
    vi.useFakeTimers();
    const body = new ReadableStream<Uint8Array>();
    const pending = handler(new Request("http://local.invalid/test", { method: "POST", body, duplex: "half" } as RequestInit));
    await vi.advanceTimersByTimeAsync(10000);
    const response = await pending;
    expect(response.status).toBe(408);
    expect(await response.json()).toEqual({ error: "Request body unavailable" });
  });
});
