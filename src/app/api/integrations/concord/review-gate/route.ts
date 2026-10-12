import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { assessConcordReview } from "../../../../../core/integrations/concord-review";

const maxBodyBytes = 262144;
class PayloadTooLargeError extends Error {}

async function readJsonBody(request: Request): Promise<unknown> {
  if (!request.body) throw new SyntaxError("Malformed JSON");
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBodyBytes) throw new PayloadTooLargeError();
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } catch (error) {
    void reader.cancel().catch(() => {});
    if (error instanceof PayloadTooLargeError) throw error;
    throw new SyntaxError("Malformed JSON");
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(text);
}

export async function POST(request: Request) {
  if (Number(request.headers.get("content-length") ?? "0") > maxBodyBytes) {
    void request.body?.cancel().catch(() => {});
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }
  try {
    return NextResponse.json(assessConcordReview(await readJsonBody(request)));
  } catch (error) {
    if (error instanceof PayloadTooLargeError) {
      return NextResponse.json({ error: "Payload too large" }, { status: 413 });
    }
    if (error instanceof ZodError) {
      return NextResponse.json({ error: "Invalid Concord evidence" }, { status: 400 });
    }
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: "Malformed JSON" }, { status: 400 });
    }
    return NextResponse.json({ error: "Unable to evaluate Concord evidence" }, { status: 500 });
  }
}
