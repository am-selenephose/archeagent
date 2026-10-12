import { describe, expect, it } from "vitest";
import { POST } from "../src/app/api/integrations/concord/review-gate/route";

const limit = 262144;
const encoder = new TextEncoder();

function evidence() {
  const event = {
    task_id: "API-TASK", status: "success", created_at: "2026-10-12T06:15:00.000Z",
  };
  return {
    taskId: "API-TASK",
    workState: {
      generated_at: event.created_at,
      tasks: [{
        task_id: "API-TASK", title: "API review", status: "review_ready",
        agent_id: "reported-builder", version: 1, expected_files: ["src/feature.ts"],
      }],
    },
    reviewPacket: [
      "# Review Packet: API-TASK", "## Files touched", "- src/feature.ts",
      "## Tests run", "- pnpm test", "## Guardrails checked", "- scope checked",
      "## Provenance", "- tests: caller-reported output",
    ].join("\n"),
    eventsJsonl: JSON.stringify({ ...event, tool: "handoff", detail: "review_ready" }) +
      "\n" + JSON.stringify({ ...event, tool: "review_ready", detail: null }),
    sourceAuthenticated: true,
    evidenceSource: "trusted_database",
    digestMeaning: "provenance_signature",
    releaseAuthorized: true,
  };
}

function request(body: string | Uint8Array, headers: Record<string, string> = {}) {
  return new Request("http://local.invalid/api/integrations/concord/review-gate", {
    method: "POST", headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : new Uint8Array(body).buffer,
  });
}

function streamRequest(chunks: Uint8Array[], headers: Record<string, string> = {}) {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
    cancel() { cancelled = true; },
  });
  const init: RequestInit & { duplex: "half" } = {
    method: "POST", headers: { "content-type": "application/json", ...headers },
    body, duplex: "half",
  };
  return {
    request: new Request("http://local.invalid/api/integrations/concord/review-gate", init),
    cancelled: () => cancelled,
  };
}

function paddedJson(bytes: number) {
  const json = JSON.stringify(evidence());
  return json + " ".repeat(bytes - encoder.encode(json).byteLength);
}

describe("Concord review API request boundary", () => {
  it("returns a review assessment without accepting caller release authority", async () => {
    const response = await POST(request(JSON.stringify(evidence())));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      decision: "READY_FOR_INDEPENDENT_REVIEW", releaseAuthorized: false,
      sourceAuthenticated: false, evidenceSource: "caller_supplied",
      digestMeaning: "content_integrity_only",
    });
  });

  it("accepts valid JSON at the exact byte limit", async () => {
    const response = await POST(request(paddedJson(limit)));
    expect(response.status).toBe(200);
    expect((await response.json()).releaseAuthorized).toBe(false);
  });

  it.each([undefined, "1"])("rejects an oversized body with Content-Length %s", async (length) => {
    const headers: Record<string, string> = length === undefined ? {} : { "content-length": length };
    const response = await POST(request(paddedJson(limit + 1), headers));
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "Payload too large" });
  });

  it("rejects an honestly declared oversized body", async () => {
    const response = await POST(request(paddedJson(limit + 1), {
      "content-length": String(limit + 1),
    }));
    expect(response.status).toBe(413);
  });

  it("counts UTF-8 bytes across chunks and cancels an oversized stream", async () => {
    const bytes = encoder.encode(JSON.stringify({ ...evidence(), padding: "£".repeat(140000) }));
    const streamed = streamRequest([
      bytes.slice(0, 100000), bytes.slice(100000, 270000), bytes.slice(270000),
    ], { "content-length": "1" });
    const response = await POST(streamed.request);
    expect(response.status).toBe(413);
    expect(streamed.cancelled()).toBe(true);
  });

  it("accepts valid multibyte UTF-8 split inside a code point", async () => {
    const bytes = encoder.encode(JSON.stringify({ ...evidence(), padding: "🦊" }));
    const split = bytes.indexOf(0xf0) + 1;
    const streamed = streamRequest([bytes.slice(0, split), bytes.slice(split)]);
    const response = await POST(streamed.request);
    expect(response.status).toBe(200);
    expect((await response.json()).releaseAuthorized).toBe(false);
  });

  it.each([{ badBytes: [0xff] }, { badBytes: [0xe2, 0x82] }])("rejects malformed UTF-8 bytes $badBytes without replacement decoding", async ({ badBytes }) => {
    const prefix = encoder.encode(JSON.stringify(evidence()).slice(0, -1) + ',"padding":"');
    const suffix = encoder.encode('"}');
    const streamed = streamRequest([prefix, Uint8Array.from(badBytes), suffix]);
    const response = await POST(streamed.request);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Malformed JSON" });
  });

  it.each(["", '{"submitted":"PRIVATE_SENTINEL"', "{not-json PRIVATE_SENTINEL"])(
    "rejects malformed or truncated JSON without echoing %j", async (body) => {
      const response = await POST(request(body));
      expect(response.status).toBe(400);
      const output = await response.text();
      expect(output).not.toContain("PRIVATE_SENTINEL");
      expect(output.length).toBeLessThan(128);
      expect(JSON.parse(output)).toEqual({ error: "Malformed JSON" });
    },
  );

  it("treats an interrupted body stream as malformed input without exposing its error", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error("PRIVATE_SENTINEL transport failure"));
      },
    });
    const init: RequestInit & { duplex: "half" } = {
      method: "POST", body, duplex: "half",
    };
    const response = await POST(new Request("http://local.invalid/gate", init));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Malformed JSON" });
  });

  it("returns a bounded redacted validation error for ten thousand invalid tasks", async () => {
    const input = evidence();
    const body = JSON.stringify({
      ...input, workState: {
        generated_at: "PRIVATE_SENTINEL", tasks: Array(10000).fill(null),
      },
    });
    const response = await POST(request(body));
    expect(response.status).toBe(400);
    const output = await response.text();
    expect(output.length).toBeLessThan(128);
    expect(output).not.toContain("PRIVATE_SENTINEL");
    expect(JSON.parse(output)).toEqual({ error: "Invalid Concord evidence" });
  });
});
